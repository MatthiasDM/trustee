import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, patchOf, plusMs, randomToken, uid, now } from "../lib/util";
import { layout, sendEmail } from "../lib/email";
import { audit, escapeHtml, notifyBuilding } from "../lib/notify";
import { rateLimit } from "../lib/ratelimit";
import { exportBuilding } from "../lib/backup";
import { zipSync } from "fflate";
import { votingUnits } from "../lib/voting";
import { syncChildUnits } from "../lib/subassoc";
import { organConflict } from "../lib/governance";

const buildings = new Hono<AppEnv>();
buildings.use("*", requireAuth);

const ROLES = ["syndicus", "raad", "eigenaar", "huurder", "commissaris"] as const;

const buildingSchema = z.object({
  name: z.string().min(2).max(160),
  address: z.string().min(2).max(240),
  city: z.string().max(120).optional().nullable(),
  postal_code: z.string().max(20).optional().nullable(),
  enterprise_number: z.string().max(40).optional().nullable(),
  total_shares: z.number().int().positive().default(1000),
  fiscal_year_start: z.string().max(5).optional().nullable(),
  av_period_start: z.string().regex(/^\d{2}-\d{2}$/).optional().nullable(),
  av_period_days: z.number().int().min(1).max(60).optional(),
  reminder_auto: z.boolean().optional(),
  reminder_days_1: z.number().int().min(1).max(90).optional(),
  reminder_days_2: z.number().int().min(1).max(180).optional(),
  reminder_fee_2: z.number().min(0).max(500).optional(),
  ledger_mode: z.enum(["auto", "simple", "double"]).optional(),
  legal_proceedings: z.string().max(5000).nullable().optional(),
  insurance_info: z.string().max(2000).nullable().optional(),
  seat_address: z.string().max(300).nullable().optional(),
  provisional_acceptance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reserve_waiver_item_id: z.string().nullable().optional(),
  syndicus_info: z.object({ name: z.string().max(160).optional(), legal_form: z.string().max(60).optional(), profession: z.string().max(80).optional(), address: z.string().max(300).optional(), enterprise_number: z.string().max(40).optional(), phone: z.string().max(40).optional(), email: z.string().max(160).optional(), consult_place: z.string().max(300).optional() }).nullable().optional(),
});

/** Nieuw gebouw (VME) aanmaken binnen een org waar de gebruiker admin is. */
buildings.post("/", async (c) => {
  const user = c.get("user");
  const body = buildingSchema.extend({ org_id: z.string().optional(), org_name: z.string().min(2).max(120).optional() }).parse(await c.req.json());
  let orgId = body.org_id;
  if (!orgId) {
    // zelfbeheer: maak een org op naam van de gebruiker (of opgegeven naam)
    orgId = uid();
    const name = body.org_name ?? `${user.name} (zelfbeheer)`;
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO orgs (id, name, slug) VALUES (?, ?, ?)").bind(orgId, name, "org-" + randomToken(6).toLowerCase()),
      c.env.DB.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')").bind(orgId, user.id),
    ]);
  } else {
    const m = await c.env.DB.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").bind(orgId, user.id).first();
    if (!m && !user.is_superadmin) throw new HttpError(403, "Geen beheerder van deze organisatie");
  }
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO buildings (id, org_id, name, address, city, postal_code, enterprise_number, total_shares, fiscal_year_start) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, orgId, body.name, body.address, body.city ?? null, body.postal_code ?? null, body.enterprise_number ?? null, body.total_shares, body.fiscal_year_start ?? null),
    c.env.DB.prepare("UPDATE buildings SET av_period_start = ?, av_period_days = ? WHERE id = ?").bind(body.av_period_start ?? null, body.av_period_days ?? 15, id),
    c.env.DB.prepare("INSERT INTO building_members (building_id, user_id, role) VALUES (?, ?, 'syndicus')").bind(id, user.id),
    // standaard mappenstructuur
    ...["Statuten & basisakte", "Reglement van interne orde", "Verslagen algemene vergadering", "Boekhouding & afrekeningen", "Offertes & facturen", "Verzekeringen", "Contracten & onderhoud"].map((n) =>
      c.env.DB.prepare("INSERT INTO folders (id, building_id, name) VALUES (?, ?, ?)").bind(uid(), id, n)),
  ]);
  await audit(c.env, id, user.id, "building.create");
  return c.json({ id }, 201);
});

buildings.get("/:buildingId", requireBuilding(), async (c) => {
  const b = c.get("building");
  const row = await c.env.DB.prepare("SELECT b.*, o.name AS org_name, o.plan FROM buildings b JOIN orgs o ON o.id = b.org_id WHERE b.id = ?").bind(b.id).first();
  const stats = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM building_members WHERE building_id = ?1) AS members,
            (SELECT COUNT(*) FROM units WHERE building_id = ?1) AS units,
            (SELECT COUNT(*) FROM documents WHERE building_id = ?1) AS documents,
            (SELECT COUNT(*) FROM posts WHERE building_id = ?1 AND status IN ('open','in_progress')) AS open_posts,
            (SELECT COUNT(*) FROM polls WHERE building_id = ?1 AND status = 'open') AS open_polls,
            (SELECT COUNT(*) FROM meetings WHERE building_id = ?1 AND starts_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS upcoming_meetings`
  ).bind(b.id).first();
  const r: any = row; if (r?.syndicus_info) { try { r.syndicus_info = JSON.parse(r.syndicus_info); } catch { r.syndicus_info = null; } }
  return c.json({ ...r, role: b.role, units_owned: b.units, stats });
});

buildings.patch("/:buildingId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const body = patchOf(buildingSchema.partial(), await c.req.json());
  if (body.reserve_waiver_item_id) {
    // enkel een aangenomen beslissing met (minstens) 4/5 meerderheid ontslaat van het verplicht reservekapitaal (art. 3.86 §3 BW)
    const it = await c.env.DB.prepare("SELECT required_majority, adopted, status FROM agenda_items WHERE id = ? AND building_id = ?").bind(body.reserve_waiver_item_id, b.id).first<any>();
    if (!it || it.status !== "decided" || it.adopted !== 1 || !["four_fifths", "unanimous"].includes(it.required_majority)) throw new HttpError(400, "Kies een aangenomen beslissing van de AV met minstens 4/5 meerderheid (art. 3.86 §3 BW)");
  }
  const fields = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v && typeof v === "object" ? JSON.stringify(v) : v] as [string, unknown]);
  if (!fields.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE buildings SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, v]) => v), b.id).run();
  await audit(c.env, b.id, c.get("user").id, "building.update", "building", b.id, body);
  return c.json({ ok: true });
});

// ---- Leden ----
buildings.get("/:buildingId/members", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare(
    `SELECT bm.user_id, u.name, u.email, u.phone, bm.role, bm.joined_at, bm.ecomm_consent_at, bm.ecomm_consent_via,
            (SELECT GROUP_CONCAT(un.label, ', ') FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE uo.user_id = bm.user_id AND un.building_id = bm.building_id) AS units
     FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? ORDER BY bm.role, u.name`
  ).bind(b.id).all();
  const invites = b.role === "syndicus"
    ? (await c.env.DB.prepare("SELECT i.id, i.email, i.name, i.role, i.expires_at, i.accepted_at, i.created_at, u.label AS unit_label FROM invites i LEFT JOIN units u ON u.id = i.unit_id WHERE i.building_id = ? AND i.accepted_at IS NULL ORDER BY i.created_at DESC").bind(b.id).all()).results
    : [];
  return c.json({ members: rows.results, invites });
});

buildings.patch("/:buildingId/members/:userId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const body = z.object({ role: z.enum(ROLES).optional(), ecomm_consent_at: z.string().nullable().optional() }).parse(await c.req.json());
  if (body.role) {
    if (["syndicus", "raad", "commissaris"].includes(body.role)) {
      const today = new Date().toISOString().slice(0, 10);
      const clash = await organConflict(c.env, b.id, c.req.param("userId"), body.role, today, today);
      if (clash) throw new HttpError(400, clash);
    }
    await c.env.DB.prepare("UPDATE building_members SET role = ? WHERE building_id = ? AND user_id = ?").bind(body.role, b.id, c.req.param("userId")).run();
    await audit(c.env, b.id, c.get("user").id, "member.role", "user", c.req.param("userId"), { role: body.role });
  }
  // Schriftelijk akkoord voor elektronische communicatie, ontvangen door de syndicus (datum van het document); bewaar het document zelf onder Documenten.
  if (body.ecomm_consent_at !== undefined) {
    await c.env.DB.prepare("UPDATE building_members SET ecomm_consent_at = ?, ecomm_consent_via = ? WHERE building_id = ? AND user_id = ?").bind(body.ecomm_consent_at, body.ecomm_consent_at ? "written" : null, b.id, c.req.param("userId")).run();
    await audit(c.env, b.id, c.get("user").id, "member.ecomm_consent_written", "user", c.req.param("userId"), { date: body.ecomm_consent_at });
  }
  return c.json({ ok: true });
});

buildings.delete("/:buildingId/members/:userId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const target = c.req.param("userId");
  if (target === c.get("user").id) throw new HttpError(400, "Je kan jezelf niet verwijderen");
  const tm = await c.env.DB.prepare("SELECT bm.role, u.name FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.user_id = ?").bind(b.id, target).first<any>();
  if (!tm) throw new HttpError(404, "Geen lid van dit gebouw");
  if (tm.role === "syndicus") {
    const others = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM building_members WHERE building_id = ? AND role = 'syndicus' AND user_id != ?").bind(b.id, target).first<{ n: number }>();
    const org = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM org_members om JOIN buildings bb ON bb.org_id = om.org_id WHERE bb.id = ?").bind(b.id).first<{ n: number }>();
    if (!(others?.n ?? 0) && !(org?.n ?? 0)) throw new HttpError(400, "Dit is de enige syndicus van het gebouw: nodig eerst een opvolger uit, anders kan niemand het gebouw nog beheren");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM building_members WHERE building_id = ? AND user_id = ?").bind(b.id, target),
    c.env.DB.prepare("DELETE FROM unit_owners WHERE user_id = ? AND unit_id IN (SELECT id FROM units WHERE building_id = ?)").bind(target, b.id),
  ]);
  await audit(c.env, b.id, c.get("user").id, "member.remove", "user", target, { name: tm.name, role: tm.role });
  // Toezicht: de raad wordt verwittigd wanneer een lid verwijderd wordt (tegen stil verwijderen van kritische stemmen).
  await notifyBuilding(c.env, { buildingId: b.id, type: "member", title: `Lid verwijderd: ${tm.name}`, body: `${c.get("user").name} heeft ${tm.name} (${tm.role}) uit ${b.name} verwijderd.`, link: `/b/${b.id}/members`, roles: ["raad", "commissaris"], excludeUserId: c.get("user").id, email: false });
  return c.json({ ok: true });
});

/** Eigen notificatievoorkeuren voor dit gebouw. */
buildings.patch("/:buildingId/me/preferences", requireBuilding(), async (c) => {
  const b = c.get("building");
  const body = z.object({ notify_email: z.boolean().optional(), notify_push: z.boolean().optional(), ecomm_consent: z.boolean().optional() }).parse(await c.req.json());
  await c.env.DB.prepare("UPDATE building_members SET notify_email = COALESCE(?, notify_email), notify_push = COALESCE(?, notify_push) WHERE building_id = ? AND user_id = ?")
    .bind(body.notify_email === undefined ? null : +body.notify_email, body.notify_push === undefined ? null : +body.notify_push, b.id, c.get("user").id).run();
  // Akkoord met elektronische oproeping en kennisgeving (in plaats van aangetekend): door het lid zelf gegeven, gelogd.
  if (body.ecomm_consent !== undefined) {
    await c.env.DB.prepare("UPDATE building_members SET ecomm_consent_at = ?, ecomm_consent_via = ? WHERE building_id = ? AND user_id = ?").bind(body.ecomm_consent ? now() : null, body.ecomm_consent ? "app" : null, b.id, c.get("user").id).run();
    await audit(c.env, b.id, c.get("user").id, body.ecomm_consent ? "member.ecomm_consent" : "member.ecomm_consent_withdrawn", "user", c.get("user").id);
  }
  return c.json({ ok: true });
});
buildings.get("/:buildingId/me/preferences", requireBuilding(), async (c) => {
  const row = await c.env.DB.prepare("SELECT notify_email, notify_push, ecomm_consent_at, ecomm_consent_via FROM building_members WHERE building_id = ? AND user_id = ?").bind(c.get("building").id, c.get("user").id).first();
  return c.json(row ?? { notify_email: 1, notify_push: 1 });
});

// ---- Uitnodigingen ----
buildings.post("/:buildingId/invites", rateLimit({ name: "invites", limit: 20, windowSec: 3600 }), requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const body = z.object({
    invites: z.array(z.object({ email: z.string().email(), name: z.string().max(120).optional(), role: z.enum(ROLES), unit_id: z.string().optional().nullable() })).min(1).max(200),
  }).parse(await c.req.json());
  const created: string[] = []; const tokens: { email: string; token: string }[] = [];
  for (const inv of body.invites) {
    const email = inv.email.toLowerCase().trim();
    const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (existingUser) {
      const member = await c.env.DB.prepare("SELECT 1 FROM building_members WHERE building_id = ? AND user_id = ?").bind(b.id, existingUser.id).first();
      if (member) continue; // al lid
    }
    const id = uid();
    const token = randomToken();
    await c.env.DB.prepare("INSERT INTO invites (id, building_id, email, name, role, unit_id, token, invited_by, expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, b.id, email, inv.name ?? null, inv.role, inv.unit_id ?? null, token, user.id, plusMs(1000 * 60 * 60 * 24 * 14)).run();
    const url = `${c.env.APP_URL}/invite/${token}`;
    await sendEmail(c.env, email, `Uitnodiging voor ${b.name}`,
      layout(c.env, `Je bent uitgenodigd voor ${escapeHtml(b.name)}`, `<p>${escapeHtml(user.name)} nodigt je uit om toe te treden tot het platform van de VME <strong>${escapeHtml(b.name)}</strong> als ${inv.role}.</p><p>Hier vind je alle documenten, mededelingen, vragen en stemmingen van je gebouw.</p>`, { label: "Uitnodiging accepteren", url }),
      `Je bent uitgenodigd voor ${b.name}: ${url}`);
    created.push(id); tokens.push({ email, token });
  }
  await audit(c.env, b.id, user.id, "invite.create", undefined, undefined, { count: created.length });
  return c.json({ created: created.length, ...(c.env.TEST_MODE === "1" ? { tokens } : {}) });
});

buildings.delete("/:buildingId/invites/:inviteId", requireBuilding("syndicus"), async (c) => {
  await c.env.DB.prepare("DELETE FROM invites WHERE id = ? AND building_id = ?").bind(c.req.param("inviteId"), c.get("building").id).run();
  return c.json({ ok: true });
});

// ---- Kavels ----
buildings.get("/:buildingId/units", requireBuilding(), async (c) => {
  const b = c.get("building");
  const units = (await c.env.DB.prepare("SELECT * FROM units WHERE building_id = ? ORDER BY floor, label").bind(b.id).all()).results as any[];
  const owners = (await c.env.DB.prepare(
    "SELECT uo.unit_id, uo.user_id, uo.share_pct, uo.right_type, u.name, u.email FROM unit_owners uo JOIN users u ON u.id = uo.user_id JOIN units un ON un.id = uo.unit_id WHERE un.building_id = ?"
  ).bind(b.id).all()).results as any[];
  for (const u of units) u.owners = owners.filter((o) => o.unit_id === u.id);
  const vunits = await votingUnits(c.env, b.id);
  for (const u of units) { const v = vunits.find((x) => x.unit_id === u.id); u.split = !!v?.split; u.suspended = !!v?.suspended; u.voter_id = v?.voter_id ?? null; u.voter_name = v?.voter_name ?? null; }
  const sumShares = units.reduce((s, u) => s + (u.shares ?? 0), 0);
  return c.json({ units, total_shares: b.total_shares, sum_shares: sumShares });
});

const unitSchema = z.object({ label: z.string().min(1).max(60), type: z.string().max(30).default("appartement"), floor: z.string().max(20).optional().nullable(), shares: z.number().int().min(0).default(0) });

buildings.post("/:buildingId/units", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const body = z.union([unitSchema, z.array(unitSchema)]).parse(await c.req.json());
  const list = Array.isArray(body) ? body : [body];
  const ids: string[] = [];
  await c.env.DB.batch(list.map((u) => { const id = uid(); ids.push(id); return c.env.DB.prepare("INSERT INTO units (id, building_id, label, type, floor, shares) VALUES (?,?,?,?,?,?)").bind(id, b.id, u.label, u.type, u.floor ?? null, u.shares); }));
  return c.json({ ids }, 201);
});

buildings.patch("/:buildingId/units/:unitId", requireBuilding("syndicus"), async (c) => {
  const body = patchOf(unitSchema.partial(), await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE units SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("unitId"), c.get("building").id).run();
  return c.json({ ok: true });
});

buildings.delete("/:buildingId/units/:unitId", requireBuilding("syndicus"), async (c) => {
  await c.env.DB.prepare("DELETE FROM units WHERE id = ? AND building_id = ?").bind(c.req.param("unitId"), c.get("building").id).run();
  return c.json({ ok: true });
});

buildings.put("/:buildingId/units/:unitId/owners", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const { owners } = z.object({ owners: z.array(z.object({ user_id: z.string(), share_pct: z.number().min(0).max(100).default(100), right_type: z.enum(["vol", "blote_eigendom", "vruchtgebruik", "erfpacht", "opstal", "gebruik_bewoning"]).default("vol") })) }).parse(await c.req.json());
  const unitId = c.req.param("unitId");
  const unit = await c.env.DB.prepare("SELECT id, parent_unit_id FROM units WHERE id = ? AND building_id = ?").bind(unitId, b.id).first<any>();
  if (!unit) throw new HttpError(404, "Kavel niet gevonden");
  if (unit.parent_unit_id) throw new HttpError(400, "De eigenaars van deze kavel worden overgenomen uit de hoofdvereniging; wijzig ze daar");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM unit_owners WHERE unit_id = ?").bind(unitId),
    ...owners.map((o) => c.env.DB.prepare("INSERT INTO unit_owners (unit_id, user_id, share_pct, right_type) VALUES (?,?,?,?)").bind(unitId, o.user_id, o.share_pct, o.right_type)),
  ]);
  await syncChildUnits(c.env.DB, unitId); // spiegelkavels in deelverenigingen volgen
  const v = (await votingUnits(c.env, b.id)).find((x) => x.unit_id === unitId);
  return c.json({ ok: true, split: !!v?.split, suspended: !!v?.suspended });
});

/**
 * Lasthebber van een kavel met gesplitste eigendom (art. 3.87 §1, lid 2 BW): de belanghebbenden delen hem schriftelijk mee aan de syndicus,
 * die hem hier registreert (met de mededeling als bewijsstuk). Hij wordt opgeroepen, neemt deel en stemt voor de hele kavel.
 * De syndicus kan geen lasthebber zijn (art. 3.87 §7).
 */
buildings.put("/:buildingId/units/:unitId/representative", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { user_id, document_id } = z.object({ user_id: z.string().nullable(), document_id: z.string().nullable().optional() }).parse(await c.req.json());
  const unit = await c.env.DB.prepare("SELECT id, label, parent_unit_id FROM units WHERE id = ? AND building_id = ?").bind(c.req.param("unitId"), b.id).first<any>();
  if (!unit) throw new HttpError(404, "Kavel niet gevonden");
  if (unit.parent_unit_id) throw new HttpError(400, "De lasthebber van deze kavel wordt overgenomen uit de hoofdvereniging");
  if (user_id) {
    const m = await c.env.DB.prepare("SELECT bm.role, u.name FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.user_id = ?").bind(b.id, user_id).first<any>();
    if (!m) throw new HttpError(400, "De lasthebber moet lid zijn van het platform voor dit gebouw (nodig uit indien nodig)");
    if (m.role === "syndicus") throw new HttpError(400, "De syndicus kan geen lasthebber van een mede-eigenaar zijn (art. 3.87 §7 BW)");
    if (m.role === "huurder") throw new HttpError(400, "Een huurder kan geen lasthebber zijn; geef hem eerst de rol mede-eigenaar of kies een titularis");
  }
  await c.env.DB.prepare("UPDATE units SET representative_user_id = ?, representative_set_at = ?, representative_document_id = ? WHERE id = ?").bind(user_id, user_id ? now() : null, document_id ?? null, unit.id).run();
  await syncChildUnits(c.env.DB, unit.id);
  await audit(c.env, b.id, user.id, user_id ? "unit.representative" : "unit.representative_removed", "unit", unit.id, { user_id });
  if (user_id) await notifyBuilding(c.env, { buildingId: b.id, type: "member", title: `Je bent lasthebber voor kavel ${unit.label}`, body: "Je wordt opgeroepen voor de algemene vergaderingen, ontvangt de stukken en stemt voor deze kavel (art. 3.87 §1, lid 2 BW).", link: `/b/${b.id}/meetings`, userIds: [user_id], email: false });
  return c.json({ ok: true });
});

// ---- Audit log ----
buildings.get("/:buildingId/audit", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const rows = await c.env.DB.prepare("SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.building_id = ? ORDER BY a.created_at DESC LIMIT 200").bind(c.get("building").id).all();
  return c.json(rows.results);
});

// ---- Mededeling naar iedereen (snelle broadcast) ----
buildings.post("/:buildingId/broadcast", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const { title, body, roles } = z.object({ title: z.string().min(2).max(200), body: z.string().min(1).max(5000), roles: z.array(z.enum(ROLES)).optional() }).parse(await c.req.json());
  await notifyBuilding(c.env, { buildingId: b.id, type: "broadcast", title, body, roles, link: `/b/${b.id}` });
  await audit(c.env, b.id, c.get("user").id, "broadcast", undefined, undefined, { title });
  return c.json({ ok: true });
});

/** Volledig archief als zip: JSON-export + alle documenten (mapstructuur) + leeswijzer. Zo bezit de VME haar archief, los van Trustee of het kantoor. */
buildings.get("/:buildingId/archive.zip", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const data = await exportBuilding(c.env, b.id) as any;
  const folders = new Map<string, string>(); for (const f of data.folders as any[]) folders.set(f.id, f.name.replace(/[\\/:*?"<>|]/g, "_"));
  const files: Record<string, Uint8Array> = {};
  files["export.json"] = new TextEncoder().encode(JSON.stringify(data, null, 1));
  files["LEESMIJ.txt"] = new TextEncoder().encode(`Archief van ${b.name}, gemaakt op ${new Date().toISOString()} met Trustee.\n\nexport.json: alle gegevens (leden, kavels, vergaderingen, beslissingen, stemmingen, boekhouding, logboek) in open JSON-formaat.\ndocumenten/: alle documenten in hun mapstructuur; afrekeningen en herinneringen per kavel staan in documenten/kavels/.\n\nDe wettelijke bewaarplicht (o.m. 7 jaar voor boekhoudkundige stukken) rust op de syndicus. Bewaar dit archief op een veilige plaats.\n`);
  const used = new Set<string>();
  for (const d of data.documents as any[]) {
    if (d.deleted_at) continue;
    const obj = await c.env.DOCS.get(d.r2_key); if (!obj) continue;
    const dir = d.unit_id ? "documenten/kavels" : `documenten/${d.folder_id ? folders.get(d.folder_id) ?? "overig" : "algemeen"}`;
    let name = `${dir}/${d.name.replace(/[\\/:*?"<>|]/g, "_")}`; let i = 2; while (used.has(name)) { name = name.replace(/(\.[^.]+)?$/, ` (${i++})$1`); } used.add(name);
    files[name] = new Uint8Array(await obj.arrayBuffer());
  }
  const zip = zipSync(files, { level: 6 });
  await audit(c.env, b.id, c.get("user").id, "building.archive", undefined, undefined, { documents: used.size });
  return new Response(zip as any, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="archief-${b.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.zip"` } });
});

// ---- Back-up / export van alle gegevens van het gebouw (JSON) ----
buildings.get("/:buildingId/export", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const b = c.get("building");
  const data = await exportBuilding(c.env, b.id);
  await audit(c.env, b.id, c.get("user").id, "building.export");
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="trustee-${b.id}-${new Date().toISOString().slice(0, 10)}.json"` } });
});
buildings.get("/:buildingId/backups", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const b = c.get("building");
  const list = await c.env.DOCS.list({ prefix: `backups/${b.id}/` });
  const lastCron = await c.env.KV.get("cron:last");
  return c.json({ backups: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })).sort((x, y) => (x.uploaded < y.uploaded ? 1 : -1)), last_cron: lastCron ? JSON.parse(lastCron) : null });
});
buildings.get("/:buildingId/backups/:key{.+}", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const b = c.get("building");
  const key = c.req.param("key");
  if (!key.startsWith(`backups/${b.id}/`)) throw new HttpError(403, "Geen toegang");
  const obj = await c.env.DOCS.get(key);
  if (!obj) throw new HttpError(404, "Back-up niet gevonden");
  return new Response(obj.body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${key.split("/").pop()}"` } });
});

export default buildings;
