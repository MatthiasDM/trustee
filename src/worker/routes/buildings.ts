import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, patchOf, plusMs, randomToken, uid } from "../lib/util";
import { layout, sendEmail } from "../lib/email";
import { audit, escapeHtml, notifyBuilding } from "../lib/notify";
import { rateLimit } from "../lib/ratelimit";
import { exportBuilding } from "../lib/backup";

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
  return c.json({ ...row, role: b.role, units_owned: b.units, stats });
});

buildings.patch("/:buildingId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const body = patchOf(buildingSchema.partial(), await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v] as [string, unknown]);
  if (!fields.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE buildings SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, v]) => v), b.id).run();
  await audit(c.env, b.id, c.get("user").id, "building.update", "building", b.id, body);
  return c.json({ ok: true });
});

// ---- Leden ----
buildings.get("/:buildingId/members", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare(
    `SELECT bm.user_id, u.name, u.email, u.phone, bm.role, bm.joined_at,
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
  const { role } = z.object({ role: z.enum(ROLES) }).parse(await c.req.json());
  await c.env.DB.prepare("UPDATE building_members SET role = ? WHERE building_id = ? AND user_id = ?").bind(role, b.id, c.req.param("userId")).run();
  await audit(c.env, b.id, c.get("user").id, "member.role", "user", c.req.param("userId"), { role });
  return c.json({ ok: true });
});

buildings.delete("/:buildingId/members/:userId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const target = c.req.param("userId");
  if (target === c.get("user").id) throw new HttpError(400, "Je kan jezelf niet verwijderen");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM building_members WHERE building_id = ? AND user_id = ?").bind(b.id, target),
    c.env.DB.prepare("DELETE FROM unit_owners WHERE user_id = ? AND unit_id IN (SELECT id FROM units WHERE building_id = ?)").bind(target, b.id),
  ]);
  await audit(c.env, b.id, c.get("user").id, "member.remove", "user", target);
  return c.json({ ok: true });
});

/** Eigen notificatievoorkeuren voor dit gebouw. */
buildings.patch("/:buildingId/me/preferences", requireBuilding(), async (c) => {
  const b = c.get("building");
  const body = z.object({ notify_email: z.boolean().optional(), notify_push: z.boolean().optional() }).parse(await c.req.json());
  await c.env.DB.prepare("UPDATE building_members SET notify_email = COALESCE(?, notify_email), notify_push = COALESCE(?, notify_push) WHERE building_id = ? AND user_id = ?")
    .bind(body.notify_email === undefined ? null : +body.notify_email, body.notify_push === undefined ? null : +body.notify_push, b.id, c.get("user").id).run();
  return c.json({ ok: true });
});
buildings.get("/:buildingId/me/preferences", requireBuilding(), async (c) => {
  const row = await c.env.DB.prepare("SELECT notify_email, notify_push FROM building_members WHERE building_id = ? AND user_id = ?").bind(c.get("building").id, c.get("user").id).first();
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
    "SELECT uo.unit_id, uo.user_id, uo.share_pct, u.name, u.email FROM unit_owners uo JOIN users u ON u.id = uo.user_id JOIN units un ON un.id = uo.unit_id WHERE un.building_id = ?"
  ).bind(b.id).all()).results as any[];
  for (const u of units) u.owners = owners.filter((o) => o.unit_id === u.id);
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
  const { owners } = z.object({ owners: z.array(z.object({ user_id: z.string(), share_pct: z.number().min(0).max(100).default(100) })) }).parse(await c.req.json());
  const unitId = c.req.param("unitId");
  const unit = await c.env.DB.prepare("SELECT id FROM units WHERE id = ? AND building_id = ?").bind(unitId, b.id).first();
  if (!unit) throw new HttpError(404, "Kavel niet gevonden");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM unit_owners WHERE unit_id = ?").bind(unitId),
    ...owners.map((o) => c.env.DB.prepare("INSERT INTO unit_owners (unit_id, user_id, share_pct) VALUES (?,?,?)").bind(unitId, o.user_id, o.share_pct)),
  ]);
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
