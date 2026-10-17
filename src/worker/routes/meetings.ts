import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, patchOf, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { isBoard, isCoOwner } from "../lib/auth";
import { attendance, MAJ, renderMinutesHtml, tally, validateProxy } from "../lib/meeting";
import { canManageMeeting, hasSyndicus, ownerConveneRight } from "../lib/governance";
import { suspendedFor, voterIds, votingUnits, weightOf } from "../lib/voting";
import { Pdf, pdfOpts } from "../lib/pdf";
import { storeDocument } from "../lib/reports";

const meetings = new Hono<AppEnv>();
meetings.use("*", requireAuth);

const schema = z.object({
  title: z.string().min(3).max(200),
  type: z.enum(["av", "bav", "raad"]).default("av"),
  starts_at: z.string().datetime(),
  location: z.string().max(300).optional().nullable(),
  agenda: z.string().max(20000).optional().nullable(),
  minutes_document_id: z.string().nullable().optional(),
  is_second_call: z.boolean().optional(),
  chair_user_id: z.string().nullable().optional(),
  secretary_user_id: z.string().nullable().optional(),
  notify: z.boolean().default(true),
});

/** Laadt de vergadering en controleert dat de gebruiker ze mag beheren (orgaan, of de mede-eigenaar die ze wettig zelf bijeenriep). */
async function managedMeeting(c: Context<AppEnv>, opts: { finalize?: boolean } = {}) {
  const b = c.get("building"); const user = c.get("user");
  const m = await c.env.DB.prepare("SELECT * FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (!canManageMeeting(b, user.id, m, opts)) throw new HttpError(403, opts.finalize ? "Enkel de syndicus of wie de vergadering wettig bijeenriep kan de notulen definitief maken" : "Onvoldoende rechten voor deze vergadering");
  return m;
}

meetings.get("/:buildingId/meetings", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare(
    `SELECT m.*, d.name AS minutes_name, ch.name AS chair_name, se.name AS secretary_name, cv.name AS convened_by_name, cb.name AS cancelled_by_name, cr.name AS created_by_name,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='attending') AS attending,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='proxy') AS proxy,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='absent') AS absent,
       (SELECT status FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.user_id = ?2) AS my_rsvp,
       (SELECT reported_missing_at FROM minutes_receipts mr WHERE mr.meeting_id = m.id AND mr.user_id = ?2) AS my_minutes_missing
     FROM meetings m LEFT JOIN documents d ON d.id = m.minutes_document_id LEFT JOIN users ch ON ch.id = m.chair_user_id LEFT JOIN users se ON se.id = m.secretary_user_id LEFT JOIN users cv ON cv.id = m.convened_by LEFT JOIN users cb ON cb.id = m.cancelled_by LEFT JOIN users cr ON cr.id = m.created_by WHERE m.building_id = ?1 ORDER BY m.starts_at DESC`
  ).bind(b.id, c.get("user").id).all();
  return c.json((rows.results as any[]).map((m) => ({ ...m, can_manage: canManageMeeting(b, c.get("user").id, m) })));
});

meetings.post("/:buildingId/meetings", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const body = schema.parse(await c.req.json());
  // Organen plannen vrij. Een mede-eigenaar enkel op een wettelijke grond (art. 3.87 §2, lid 3 of 4): dan is het een "eigen" vergadering die hij ook zelf beheert.
  const right = isBoard(b.role) ? null : await ownerConveneRight(c.env, b, user.id);
  if (!isBoard(b.role) && !right) throw new HttpError(403, "Enkel de syndicus of de raad plant vergaderingen. Mede-eigenaars mogen zelf bijeenroepen als de syndicus binnen 30 dagen geen gevolg gaf aan een 1/5-verzoek, of bij gebreke van een syndicus (art. 3.87 §2 BW).");
  if (right && body.type === "raad") throw new HttpError(400, "Mede-eigenaars roepen een algemene vergadering bijeen, geen raad");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO meetings (id, building_id, title, type, starts_at, location, agenda, minutes_document_id, created_by, convened_by_owners, legal_basis, request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, body.title, body.type, body.starts_at, body.location ?? null, body.agenda ?? null, body.minutes_document_id ?? null, user.id, right ? 1 : 0, right?.text ?? null, right?.request_id ?? null).run();
  await audit(c.env, b.id, user.id, right ? "meeting.create_by_owner" : "meeting.create", "meeting", id, { title: body.title, basis: right?.basis ?? null });
  if (right) {
    // het verzoek is hiermee ingewilligd door de ondertekenaar zelf; onderwerp op de agenda, en bij gebreke van een syndicus ook de aanwijzing
    const req = right.request_id ? await c.env.DB.prepare("SELECT * FROM meeting_requests WHERE id = ?").bind(right.request_id).first<any>() : null;
    const items: [string, string | null][] = [];
    if (req) items.push([req.subject, [req.body, right.text].filter(Boolean).join("\n\n")]);
    if (right.basis === "no_syndicus" && !items.some(([t]) => /syndicus/i.test(t))) items.push(["Aanwijzing van een syndicus", "Bij gebreke van een syndicus bijeengeroepen om een syndicus aan te wijzen (art. 3.87 §2, lid 4 BW)."]);
    for (const [i, [title, desc]] of items.entries()) await c.env.DB.prepare("INSERT INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status, position) VALUES (?,?,?,?,?,?,'simple','scheduled',?)").bind(uid(), b.id, id, req?.created_by ?? user.id, title, desc, i).run();
    if (req && req.status !== "fulfilled") await c.env.DB.prepare("UPDATE meeting_requests SET status = 'fulfilled', fulfilled_meeting_id = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?").bind(id, now(), user.id, "Zelf bijeengeroepen door een ondertekenaar (art. 3.87 §2 BW)", req.id).run();
    await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `Vergadering bijeengeroepen door mede-eigenaars: ${body.title}`, body: `${user.name} plant een algemene vergadering. ${right.text}. De oproeping volgt.`, link: `/b/${b.id}/meetings`, roles: ["syndicus", "raad", "commissaris"], excludeUserId: user.id });
  }
  // De oproeping is een aparte, bewuste handeling (POST .../convene) met voorbeeld en termijncontrole; aanmaken verstuurt niets.
  if (body.notify && false) {
    const when = new Date(body.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
    await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `Uitnodiging: ${body.title}`, body: `${when}${body.location ? ` — ${body.location}` : ""}. Laat weten of je aanwezig bent.`, link: `/b/${b.id}/meetings`, roles: body.type === "raad" ? ["syndicus", "raad", "commissaris"] : ["syndicus", "raad", "eigenaar", "commissaris"], excludeUserId: user.id });
  }
  return c.json({ id }, 201);
});

meetings.patch("/:buildingId/meetings/:meetingId", requireBuilding(), async (c) => {
  const b = c.get("building");
  const body = patchOf(schema.partial(), await c.req.json());
  const { notify: _n, ...rest } = body;
  const before = await managedMeeting(c);
  if (before.cancelled_at) throw new HttpError(400, "Deze vergadering is geannuleerd");
  const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v]);
  if (fields.length) await c.env.DB.prepare(`UPDATE meetings SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("meetingId"), b.id).run();
  // Al opgeroepen en datum of plaats gewijzigd: iedereen verwittigen en de oproeping als "opnieuw te versturen" markeren (nieuwe termijn van 15 dagen).
  const moved = before.convened_at && ((rest.starts_at && rest.starts_at !== before.starts_at) || (rest.location !== undefined && (rest.location ?? null) !== (before.location ?? null)));
  if (moved) {
    await c.env.DB.prepare("UPDATE meetings SET convened_at = NULL, convened_by = NULL WHERE id = ?").bind(before.id).run();
    const when = new Date(rest.starts_at ?? before.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
    await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `Gewijzigd: ${before.title}`, body: `Nieuwe datum of plaats: ${when}${(rest.location ?? before.location) ? ` — ${rest.location ?? before.location}` : ""}. De syndicus verstuurt een nieuwe oproeping.`, link: `/b/${b.id}/meetings`, roles: before.type === "raad" ? ["syndicus", "raad"] : undefined, excludeUserId: c.get("user").id });
    await audit(c.env, b.id, c.get("user").id, "meeting.moved", "meeting", before.id, { from: before.starts_at, to: rest.starts_at ?? before.starts_at });
  }
  if (body.minutes_document_id) {
    const m = await c.env.DB.prepare("SELECT title FROM meetings WHERE id = ?").bind(c.req.param("meetingId")).first<any>();
    await notifyBuilding(c.env, { buildingId: b.id, type: "minutes", title: `Verslag beschikbaar: ${m?.title}`, body: "Het verslag van de vergadering staat online.", link: `/b/${b.id}/meetings`, excludeUserId: c.get("user").id });
  }
  return c.json({ ok: true });
});

meetings.delete("/:buildingId/meetings/:meetingId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const m = await c.env.DB.prepare("SELECT id, title, convened_at FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (m.convened_at) throw new HttpError(400, "Deze vergadering is al opgeroepen: annuleer ze (met reden) in plaats van ze te verwijderen, zodat de leden verwittigd worden");
  await c.env.DB.prepare("DELETE FROM meetings WHERE id = ?").bind(m.id).run();
  await audit(c.env, b.id, c.get("user").id, "meeting.delete", "meeting", m.id, { title: m.title });
  return c.json({ ok: true });
});

/** Annuleren in plaats van verwijderen: blijft zichtbaar als geannuleerd, iedereen krijgt bericht, agendapunten vallen terug naar "voorgesteld". */
meetings.post("/:buildingId/meetings/:meetingId/cancel", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { reason } = z.object({ reason: z.string().min(3).max(1000) }).parse(await c.req.json());
  const m = await managedMeeting(c);
  if (m.cancelled_at) throw new HttpError(400, "Al geannuleerd");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE meetings SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?").bind(now(), user.id, reason, m.id),
    c.env.DB.prepare("UPDATE agenda_items SET meeting_id = NULL, status = 'proposed', updated_at = ? WHERE meeting_id = ? AND status = 'scheduled'").bind(now(), m.id),
    c.env.DB.prepare("DELETE FROM meeting_rsvps WHERE meeting_id = ?").bind(m.id),
  ]);
  await audit(c.env, b.id, user.id, "meeting.cancel", "meeting", m.id, { reason });
  await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `Geannuleerd: ${m.title}`, body: `De vergadering van ${new Date(m.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" })} gaat niet door. Reden: ${reason}`, link: `/b/${b.id}/meetings`, roles: m.type === "raad" ? ["syndicus", "raad"] : undefined, excludeUserId: user.id });
  return c.json({ ok: true });
});

/** Voorbeeld van de oproeping: ontvangers, akkoord elektronische communicatie, termijn (art. 3.87 §3: minstens 15 dagen), agenda. */
async function convenePreview(c: Context<AppEnv>, m: any) {
  const b = c.get("building");
  const roles = m.type === "raad" ? ["syndicus", "raad"] : ["syndicus", "raad", "eigenaar", "commissaris", "huurder"];
  const recipients = (await c.env.DB.prepare(`SELECT bm.user_id, u.name, u.email, bm.role, bm.ecomm_consent_at, bm.ecomm_consent_via, bm.notify_email,
      (SELECT GROUP_CONCAT(un.label, ', ') FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE uo.user_id = bm.user_id AND un.building_id = bm.building_id) AS units
     FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.role IN (${roles.map(() => "?").join(",")}) ORDER BY bm.role, u.name`).bind(b.id, ...roles).all()).results as any[];
  const days = Math.floor((new Date(m.starts_at).getTime() - Date.now()) / 86400_000);
  const minDays = m.type === "raad" ? 0 : 15;
  const agenda = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_items WHERE meeting_id = ? AND status = 'scheduled'").bind(m.id).first<{ n: number }>())?.n ?? 0;
  const warnings: string[] = [];
  if (days < minDays) warnings.push(`De oproeping moet minstens ${minDays} dagen vóór de vergadering verstuurd worden (art. 3.87 §3 BW); er resten ${days} dagen. Verzet de vergadering, of roep enkel op bij hoogdringendheid.`);
  if (m.type !== "raad" && agenda === 0 && !m.agenda) warnings.push("De agenda is leeg: de oproeping moet de agenda bevatten (art. 3.87 §3 BW). Agendeer eerst de punten.");
  const vunits = await votingUnits(c.env, b.id);
  for (const r of recipients) { const sus = suspendedFor(vunits, r.user_id); if (sus.length && weightOf(vunits, r.user_id) <= 0) r.represented_by = sus.map((u) => u.voter_name ? `${u.voter_name} (lasthebber kavel ${u.label})` : `niemand: kavel ${u.label} geschorst`).join("; "); }
  const suspendedUnits = vunits.filter((u) => u.suspended);
  if (suspendedUnits.length) warnings.push(`Kavel ${suspendedUnits.map((u) => u.label).join(", ")}: gesplitste eigendom zonder lasthebber. Het deelnamerecht is geschorst tot de belanghebbenden schriftelijk een lasthebber aanwijzen (art. 3.87 §1, lid 2 BW); registreer die onder Kavels.`);
  const voters = recipients.filter((r) => r.role !== "huurder" && !r.represented_by && (r.units || r.role === "eigenaar" || r.role === "raad"));
  const registered = voters.filter((r) => !r.ecomm_consent_at);
  if (registered.length) warnings.push(`${registered.length} stemgerechtigde(n) zonder akkoord voor elektronische oproeping: aan hen moet de oproeping per aangetekende brief worden verstuurd. Registreer hun schriftelijk akkoord onder Leden, of verstuur aangetekend.`);
  if (m.type !== "raad" && recipients.some((r: any) => r.role === "huurder") && !m.resident_notice_document_id) warnings.push("Er zijn bewoners zonder stemrecht: deel hen de datum mee en hang de mededeling op in de gemeenschappelijke delen, zodat ze schriftelijk vragen kunnen indienen (art. 3.89 §5, 6° BW). Maak ze aan met 'Mededeling bewoners'.");
  if (m.convened_at) warnings.push(`Al opgeroepen op ${m.convened_at.slice(0, 10)}. Opnieuw versturen stuurt een herinnering aan iedereen.`);
  return { meeting: { id: m.id, title: m.title, starts_at: m.starts_at, type: m.type, convened_at: m.convened_at, is_second_call: !!m.is_second_call }, days_until: days, min_days: minDays, agenda_items: agenda, recipients, registered_needed: registered.map((r) => r.user_id), warnings };
}
meetings.get("/:buildingId/meetings/:meetingId/convene", requireBuilding(), async (c) => {
  const m = await managedMeeting(c);
  return c.json(await convenePreview(c, m));
});
/** Oproeping versturen: bewuste handeling met bevestiging van de waarschuwingen; gelogd met wie, wanneer en aan wie. */
meetings.post("/:buildingId/meetings/:meetingId/convene", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { acknowledge } = z.object({ acknowledge: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
  const m = await managedMeeting(c);
  if (m.cancelled_at) throw new HttpError(400, "Deze vergadering is geannuleerd");
  const p = await convenePreview(c, m);
  if (p.warnings.length && !acknowledge) throw new HttpError(400, `Bevestig eerst de waarschuwingen: ${p.warnings[0]}`);
  const when = new Date(m.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
  await c.env.DB.prepare("UPDATE meetings SET convened_at = ?, convened_by = ? WHERE id = ?").bind(now(), user.id, m.id).run();
  await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `${m.convened_at ? "Herinnering oproeping" : "Oproeping"}: ${m.title}`, body: `${when}${m.location ? ` — ${m.location}` : ""}. De agenda staat in Trustee. Laat weten of je aanwezig bent of geef een volmacht.`, link: `/b/${b.id}/meetings`, userIds: p.recipients.map((r: any) => r.user_id), excludeUserId: user.id });
  await audit(c.env, b.id, user.id, "meeting.convene", "meeting", m.id, { recipients: p.recipients.length, registered_needed: p.registered_needed, days_until: p.days_until, acknowledged: p.warnings });
  return c.json({ ok: true, recipients: p.recipients.length, registered_needed: p.registered_needed.length });
});

meetings.put("/:buildingId/meetings/:meetingId/rsvp", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const { status, proxy_user_id } = z.object({ status: z.enum(["attending", "proxy", "absent"]), proxy_user_id: z.string().nullable().optional() }).parse(await c.req.json());
  const m = await c.env.DB.prepare("SELECT id, cancelled_at FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (m.cancelled_at) throw new HttpError(400, "Deze vergadering is geannuleerd");
  if (!isCoOwner(b)) throw new HttpError(403, "Enkel mede-eigenaars melden hun aanwezigheid of geven een volmacht; de syndicus woont de AV ambtshalve bij");
  {
    const vunits = await votingUnits(c.env, b.id); const sus = suspendedFor(vunits, user.id);
    if (sus.length && weightOf(vunits, user.id) <= 0) throw new HttpError(403, `Voor kavel ${sus.map((u) => u.label).join(", ")} neemt enkel de lasthebber deel aan de algemene vergadering${sus.some((u) => u.suspended) ? "; zolang die niet is aangewezen, is het deelnamerecht geschorst" : ` (${sus.map((u) => u.voter_name).join(", ")})`} (art. 3.87 §1, lid 2 BW)`);
  }
  if (status === "proxy") { if (!proxy_user_id) throw new HttpError(400, "Kies wie je volmacht krijgt"); await validateProxy(c.env, b.id, c.req.param("meetingId"), user.id, proxy_user_id); }
  await c.env.DB.prepare("INSERT INTO meeting_rsvps (meeting_id, user_id, status, proxy_user_id, updated_at) VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(meeting_id, user_id) DO UPDATE SET status = excluded.status, proxy_user_id = excluded.proxy_user_id, updated_at = excluded.updated_at")
    .bind(c.req.param("meetingId"), user.id, status, status === "proxy" ? proxy_user_id ?? null : null).run();
  return c.json({ ok: true });
});

meetings.get("/:buildingId/meetings/:meetingId/rsvps", requireBuilding(), async (c) => {
  await managedMeeting(c);
  const rows = await c.env.DB.prepare("SELECT r.status, r.updated_at, u.name, u.email, pu.name AS proxy_name FROM meeting_rsvps r JOIN users u ON u.id = r.user_id LEFT JOIN users pu ON pu.id = r.proxy_user_id WHERE r.meeting_id = ? ORDER BY r.status, u.name").bind(c.req.param("meetingId")).all();
  return c.json(rows.results);
});

/** Aanwezigheid per kavel en quorum. Leden zien de telling; de lijst met namen is voor syndicus en raad. */
meetings.get("/:buildingId/meetings/:meetingId/attendance", requireBuilding(), async (c) => {
  const b = c.get("building");
  const m = await c.env.DB.prepare("SELECT id, convened_by_owners, created_by FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  const a = await attendance(c.env, b.id, c.req.param("meetingId"));
  return c.json(canManageMeeting(b, c.get("user").id, m as any) ? a : { quorum: a.quorum, rows: [] });
});

/** Stemgerechtigde leden (voor volmachten): mede-eigenaars (kavelbezitters), nooit de syndicus, geen huurders. */
meetings.get("/:buildingId/meetings/:meetingId/proxy-candidates", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const rows = (await c.env.DB.prepare("SELECT bm.user_id, u.name, (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = ? AND r.status = 'proxy' AND r.proxy_user_id = bm.user_id) AS proxies FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.role NOT IN ('syndicus','huurder') AND bm.user_id != ? AND (bm.role IN ('eigenaar','raad') OR EXISTS (SELECT 1 FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE un.building_id = bm.building_id AND uo.user_id = bm.user_id)) ORDER BY u.name").bind(c.req.param("meetingId"), b.id, user.id).all()).results;
  return c.json(rows);
});

/**
 * Stemming per agendapunt tijdens de AV registreren (syndicus/raad): keuze per kavel, gewogen naar aandelen.
 * Onthoudingen tellen niet mee voor de meerderheid (art. 3.88 §1). Namen van tegenstemmers worden bewaard voor de notulen (art. 3.87 §12).
 */
meetings.post("/:buildingId/meetings/:meetingId/agenda/:itemId/vote", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  await managedMeeting(c);
  const item = await c.env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ? AND building_id = ?").bind(c.req.param("itemId"), c.req.param("meetingId"), b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden op deze vergadering");
  const { votes, decision, dry_run } = z.object({ votes: z.array(z.object({ unit_id: z.string(), choice: z.enum(["for", "against", "abstain", "absent"]) })), decision: z.string().max(3000).optional(), dry_run: z.boolean().default(false) }).parse(await c.req.json());
  const att = await attendance(c.env, b.id, c.req.param("meetingId"));
  const conflictIds: string[] = item.conflict_user_ids ? JSON.parse(item.conflict_user_ids) : [];
  const ids = [...new Set([...att.rows.flatMap((r) => [r.voter_id, r.holder_id]), ...conflictIds].filter(Boolean) as string[])];
  const names: Record<string, string> = {};
  if (ids.length) for (const r of (await c.env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; name: string }>()).results) names[r.id] = r.name;
  const t = tally(att.rows, votes, item.required_majority, conflictIds, names);
  if (t.invalid.length && !dry_run) throw new HttpError(400, `Kavel ${t.invalid.map((x) => x.label).join(", ")}: deelnamerecht geschorst, er is geen lasthebber aangewezen (art. 3.87 §1, lid 2 BW). Registreer als afwezig.`);
  const notes: string[] = [];
  if (t.capped.length) notes.push(`Stemplafond toegepast (art. 3.87 §8 BW): ${t.capped.map((x) => `${x.name} telde voor ${x.counted} in plaats van ${x.had} aandelen`).join("; ")}.`);
  if (t.excluded.length) notes.push(`Niet deelgenomen wegens belangenconflict (art. 3.87 §9 BW)${item.conflict_reason ? ` — ${item.conflict_reason}` : ""}: kavel ${t.excluded.map((x) => `${x.label} (${x.name})`).join(", ")}.`);
  const fmt = (x: number) => String(Math.round(x * 100) / 100);
  const text = decision ?? [`${t.reached ? "Goedgekeurd" : "Verworpen"} met ${fmt(t.votes_for)} aandelen vóór, ${fmt(t.votes_against)} tegen en ${fmt(t.votes_abstain)} onthoudingen (${MAJ[item.required_majority]?.label ?? item.required_majority}${item.required_majority !== "none" && item.required_majority !== "unanimous" ? `, ${(t.pct * 100).toFixed(1)} % van de uitgebrachte stemmen` : ""}).`, ...notes].join(" ");
  if (dry_run) return c.json({ ...t, decision: text });
  await c.env.DB.prepare("UPDATE agenda_items SET votes_for = ?, votes_against = ?, votes_abstain = ?, voters_for = ?, voters_against = ?, voters_abstain = ?, dissenters = ?, vote_detail = ?, vote_adjustments = ?, voted_at = ?, status = 'decided', decision = ?, adopted = ?, updated_at = ? WHERE id = ?")
    .bind(t.votes_for, t.votes_against, t.votes_abstain, t.voters_for, t.voters_against, t.voters_abstain, JSON.stringify(t.dissenters), JSON.stringify(votes), JSON.stringify({ capped: t.capped, excluded: t.excluded }), new Date().toISOString(), text, t.reached ? 1 : 0, new Date().toISOString(), item.id).run();
  await audit(c.env, b.id, user.id, "agenda.vote", "agenda_item", item.id, { for: t.votes_for, against: t.votes_against, abstain: t.votes_abstain, reached: t.reached, capped: t.capped.length, excluded: t.excluded.length });
  return c.json({ ok: true, ...t, decision: text });
});

/** Ontwerp van de notulen genereren uit vergadering, aanwezigheid en agendapunten. */
meetings.post("/:buildingId/meetings/:meetingId/minutes/generate", requireBuilding(), async (c) => {
  const b = c.get("building");
  await managedMeeting(c);
  const m = await c.env.DB.prepare("SELECT m.*, ch.name AS chair_name, se.name AS secretary_name FROM meetings m LEFT JOIN users ch ON ch.id = m.chair_user_id LEFT JOIN users se ON se.id = m.secretary_user_id WHERE m.id = ? AND m.building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (m.minutes_status === "final") throw new HttpError(400, "De notulen zijn al definitief");
  const a = await attendance(c.env, b.id, m.id);
  const items = (await c.env.DB.prepare("SELECT a.*, u.name AS submitted_by_name FROM agenda_items a JOIN users u ON u.id = a.submitted_by WHERE a.meeting_id = ? ORDER BY a.position, a.created_at").bind(m.id).all()).results as any[];
  const when = new Date(m.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
  const L: string[] = [];
  L.push(`# Notulen ${m.type === "bav" ? "bijzondere algemene vergadering" : m.type === "raad" ? "raad van mede-eigendom" : "algemene vergadering"} — ${m.title}`);
  L.push(`Vereniging van mede-eigenaars ${b.name}`, `Datum: ${when}${m.location ? ` · Plaats: ${m.location}` : ""}${m.is_second_call ? " · Tweede bijeenroeping" : ""}`);
  L.push(`Voorzitter: ${m.chair_name ?? "…"} · Secretaris: ${m.secretary_name ?? "…"}`, "");
  L.push("## Aanwezigheid en quorum");
  for (const r of a.rows) L.push(`- Kavel ${r.label} (${r.shares} aandelen) — ${r.owner_names || "geen eigenaar geregistreerd"}: ${r.status === "attending" ? "aanwezig" : r.status === "proxy" ? `vertegenwoordigd bij volmacht door ${r.holder_name}` : r.status === "absent" ? "afwezig" : r.status === "suspended" ? "deelnamerecht geschorst (gesplitste eigendom zonder lasthebber, art. 3.87 §1, lid 2 BW)" : "niet gemeld"}`);
  L.push(`Aanwezig of vertegenwoordigd: ${a.quorum.present_owners} van ${a.quorum.total_owners} mede-eigenaars, ${a.quorum.present_shares} van ${a.quorum.total_shares} aandelen. ${a.quorum.explanation}`, "");
  const questions = (await c.env.DB.prepare("SELECT q.body, u.name FROM meeting_questions q JOIN users u ON u.id = q.author_id WHERE q.meeting_id = ? ORDER BY q.created_at").bind(m.id).all()).results as any[];
  if (questions.length) { L.push("## Vragen en opmerkingen van bewoners zonder stemrecht (art. 3.89 §5, 6° BW)"); for (const q of questions) L.push(`- ${q.name}: ${q.body.replace(/\n+/g, " ")}`); L.push(""); }
  L.push("## Agendapunten en beslissingen");
  items.forEach((it, i) => {
    L.push(`### ${i + 1}. ${it.title}`);
    if (it.description) L.push(it.description);
    if (it.voted_at) { L.push(`Stemming (${MAJ[it.required_majority]?.label ?? it.required_majority}): ${it.votes_for} aandelen vóór (${it.voters_for} kavels), ${it.votes_against} tegen (${it.voters_against}), ${it.votes_abstain} onthoudingen (${it.voters_abstain}).`); const d = JSON.parse(it.dissenters || "[]"); L.push(d.length ? `Tegengestemd: ${d.join("; ")}.` : "Geen tegenstemmen."); }
    L.push(`Beslissing: ${it.decision ?? (it.status === "deferred" ? "uitgesteld naar een volgende vergadering" : "…")}`, "");
  });
  L.push("## Varia", "…", "", `Opgemaakt door de syndicus. Elke mede-eigenaar kan binnen vier maanden na de vergadering een onregelmatige, bedrieglijke of onrechtmatige beslissing aanvechten bij de vrederechter (art. 3.92 §3 BW).`);
  const body = L.join("\n");
  await c.env.DB.prepare("UPDATE meetings SET minutes_status = 'draft', minutes_body = ? WHERE id = ?").bind(body, m.id).run();
  return c.json({ body });
});

meetings.patch("/:buildingId/meetings/:meetingId/minutes", requireBuilding(), async (c) => {
  const b = c.get("building");
  await managedMeeting(c);
  const { body } = z.object({ body: z.string().max(200000) }).parse(await c.req.json());
  const m = await c.env.DB.prepare("SELECT minutes_status FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (m.minutes_status === "final") throw new HttpError(400, "De notulen zijn al definitief");
  await c.env.DB.prepare("UPDATE meetings SET minutes_status = 'draft', minutes_body = ? WHERE id = ?").bind(body, c.req.param("meetingId")).run();
  return c.json({ ok: true });
});

/** Notulen definitief maken: document in Documenten (Verslagen AV), koppelen, verzenden aan alle stemgerechtigden (art. 3.87 §12: binnen 30 dagen). */
meetings.post("/:buildingId/meetings/:meetingId/minutes/finalize", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await managedMeeting(c, { finalize: true });
  if (m.minutes_status !== "draft" || !m.minutes_body) throw new HttpError(400, "Maak eerst een ontwerp van de notulen");
  const html = renderMinutesHtml(`Notulen ${m.title}`, b.name, m.minutes_body);
  const docId = uid();
  const folder = await c.env.DB.prepare("SELECT id FROM folders WHERE building_id = ? AND name LIKE '%erslag%' LIMIT 1").bind(b.id).first<any>();
  const name = `Notulen ${m.title} (${m.starts_at.slice(0, 10)}).html`;
  const key = `${b.id}/${docId}/${name.replace(/[^\w.\-() ]+/g, "_")}`;
  await c.env.DOCS.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO documents (id, building_id, folder_id, name, description, category, r2_key, size, mime, visibility, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,'all',?)").bind(docId, b.id, folder?.id ?? null, name, "Definitieve notulen, verzonden aan alle stemgerechtigde mede-eigenaars.", "verslag_av", key, html.length, "text/html", user.id),
    c.env.DB.prepare("UPDATE meetings SET minutes_status = 'final', minutes_finalized_at = ?, minutes_sent_at = ?, minutes_document_id = ? WHERE id = ?").bind(new Date().toISOString(), new Date().toISOString(), docId, m.id),
  ]);
  await audit(c.env, b.id, user.id, "minutes.finalize", "meeting", m.id);
  await notifyBuilding(c.env, { buildingId: b.id, type: "minutes", title: `Notulen: ${m.title}`, body: "De notulen van de algemene vergadering zijn beschikbaar. Beslissingen kunnen binnen 4 maanden aangevochten worden (art. 3.92 §3 BW).", link: `/b/${b.id}/meetings`, roles: ["syndicus", "raad", "eigenaar", "commissaris"], excludeUserId: user.id, email: true });
  // bezorging per stemgerechtigde vastleggen (art. 3.87 §12): één per kavel (eigenaar of lasthebber), plus de andere syndici
  const recipients = new Set(voterIds(await votingUnits(c.env, b.id)));
  for (const r of (await c.env.DB.prepare("SELECT user_id FROM building_members WHERE building_id = ? AND role = 'syndicus' AND user_id != ?").bind(b.id, user.id).all<{ user_id: string }>()).results) recipients.add(r.user_id);
  const at = now();
  if (recipients.size) await c.env.DB.batch([...recipients].map((uid2) => c.env.DB.prepare("INSERT INTO minutes_receipts (meeting_id, user_id, delivered_at) VALUES (?,?,?) ON CONFLICT(meeting_id, user_id) DO UPDATE SET delivered_at = excluded.delivered_at").bind(m.id, uid2, at)));
  return c.json({ ok: true, documentId: docId });
});

// ---------- Verzoek tot AV door mede-eigenaars met minstens 1/5 van de aandelen (art. 3.87 §2) ----------
async function requestWithProgress(env: AppEnv["Bindings"], buildingId: string, req: any) {
  const total = (await env.DB.prepare("SELECT COALESCE(SUM(shares),0) AS s FROM units WHERE building_id = ?").bind(buildingId).first<any>())?.s ?? 0;
  const vunits = await votingUnits(env, buildingId);
  const sigs = ((await env.DB.prepare("SELECT s.user_id, s.signed_at, u.name FROM meeting_request_signatures s JOIN users u ON u.id = s.user_id WHERE s.request_id = ? ORDER BY s.signed_at").bind(req.id).all()).results as any[]).map((x) => ({ ...x, shares: weightOf(vunits, x.user_id) }));
  const shares = Math.round(sigs.reduce((a, x) => a + x.shares, 0) * 100) / 100;
  return { ...req, signatures: sigs, shares, total_shares: total, needed: Math.ceil(total / 5), reached: shares >= total / 5 };
}
meetings.get("/:buildingId/meeting-requests", requireBuilding(), async (c) => {
  const b = c.get("building");
  const present = await hasSyndicus(c.env, b.id);
  const right = isBoard(b.role) ? null : await ownerConveneRight(c.env, b, c.get("user").id);
  const rows = (await c.env.DB.prepare("SELECT r.*, u.name AS created_by_name, ru.name AS resolved_by_name, m.title AS meeting_title, m.starts_at AS meeting_starts_at, ai.status AS agenda_status FROM meeting_requests r JOIN users u ON u.id = r.created_by LEFT JOIN users ru ON ru.id = r.resolved_by LEFT JOIN meetings m ON m.id = r.fulfilled_meeting_id LEFT JOIN agenda_items ai ON ai.id = r.agenda_item_id WHERE r.building_id = ? ORDER BY r.created_at DESC").bind(b.id).all()).results as any[];
  const list = await Promise.all(rows.map((r) => requestWithProgress(c.env, b.id, r)));
  return c.json(list.map((r) => ({ ...r, can_convene: !!right && (right.request_id === r.id || (right.basis === "no_syndicus" && r.status === "threshold_reached")), convene_basis: right?.text ?? null, syndicus_present: present })));
});
meetings.post("/:buildingId/meeting-requests", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isCoOwner(b)) throw new HttpError(403, "Enkel mede-eigenaars kunnen een vergadering vragen");
  const { subject, body, purpose } = z.object({ subject: z.string().min(3).max(200), body: z.string().max(5000).optional(), purpose: z.enum(["general", "appoint_syndicus"]).default("general") }).parse(await c.req.json());
  const id = uid();
  await c.env.DB.batch([c.env.DB.prepare("INSERT INTO meeting_requests (id, building_id, subject, body, created_by, purpose) VALUES (?,?,?,?,?,?)").bind(id, b.id, subject, body ?? null, user.id, purpose), c.env.DB.prepare("INSERT INTO meeting_request_signatures (request_id, user_id) VALUES (?,?)").bind(id, user.id)]);
  await notifyBuilding(c.env, { buildingId: b.id, type: "meeting_request", title: `Verzoek tot algemene vergadering: ${subject}`, body: `${user.name} vraagt een AV. Onderteken mee als je het verzoek steunt; vanaf 1/5 van de aandelen moet de syndicus binnen 30 dagen bijeenroepen.`, link: `/b/${b.id}/meetings`, roles: ["eigenaar", "raad", "commissaris"], excludeUserId: user.id, email: false });
  return c.json({ id }, 201);
});
meetings.post("/:buildingId/meeting-requests/:id/sign", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isCoOwner(b)) throw new HttpError(403, "Enkel mede-eigenaars kunnen ondertekenen");
  const req = await c.env.DB.prepare("SELECT * FROM meeting_requests WHERE id = ? AND building_id = ?").bind(c.req.param("id"), b.id).first<any>();
  if (!req || req.status === "cancelled" || req.status === "fulfilled") throw new HttpError(400, "Dit verzoek is niet meer open");
  await c.env.DB.prepare("INSERT OR IGNORE INTO meeting_request_signatures (request_id, user_id) VALUES (?,?)").bind(req.id, user.id).run();
  const p = await requestWithProgress(c.env, b.id, req);
  if (p.reached && req.status === "collecting") {
    // bij gebreke van een syndicus is er geen termijn van 30 dagen: de ondertekenaars mogen meteen bijeenroepen (art. 3.87 §2, lid 4)
    const immediate = req.purpose === "appoint_syndicus" && !(await hasSyndicus(c.env, b.id));
    const deadline = new Date(Date.now() + (immediate ? 0 : 30 * 86400_000)).toISOString().slice(0, 10);
    await c.env.DB.prepare("UPDATE meeting_requests SET status = 'threshold_reached', threshold_reached_at = ?, deadline = ? WHERE id = ?").bind(new Date().toISOString(), deadline, req.id).run();
    await notifyBuilding(c.env, { buildingId: b.id, type: "meeting_request", title: `Verplichte bijeenroeping: ${req.subject}`, body: `Mede-eigenaars met ${p.shares}/${p.total_shares} aandelen (≥ 1/5) vragen een AV. De syndicus moet de bijeenroeping versturen vóór ${deadline} (art. 3.87 §2 BW).`, link: `/b/${b.id}/meetings`, roles: ["syndicus", "raad"] });
  }
  return c.json(await requestWithProgress(c.env, b.id, await c.env.DB.prepare("SELECT * FROM meeting_requests WHERE id = ?").bind(req.id).first()));
});
meetings.patch("/:buildingId/meeting-requests/:id", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const req = await c.env.DB.prepare("SELECT * FROM meeting_requests WHERE id = ? AND building_id = ?").bind(c.req.param("id"), b.id).first<any>();
  if (!req) throw new HttpError(404, "Niet gevonden");
  const body = z.object({ status: z.enum(["fulfilled", "cancelled"]), fulfilled_meeting_id: z.string().nullable().optional(), note: z.string().max(1000).nullable().optional(), required_majority: z.enum(["simple", "two_thirds", "four_fifths", "unanimous", "none"]).optional() }).parse(await c.req.json());
  if (req.status === "fulfilled" || req.status === "cancelled") throw new HttpError(400, "Dit verzoek is al afgehandeld");
  if (body.status === "cancelled" && req.created_by !== user.id && !isBoard(b.role)) throw new HttpError(403, "Geen rechten");
  if (body.status === "fulfilled") {
    if (!isBoard(b.role)) throw new HttpError(403, "Enkel de syndicus kan een verzoek als ingewilligd markeren");
    // Ingewilligd betekent: er is een vergadering bijeengeroepen. Zonder gekoppelde vergadering is het verzoek niet afgehandeld.
    if (!body.fulfilled_meeting_id) throw new HttpError(400, "Kies de vergadering die dit verzoek inwilligt");
    const m = await c.env.DB.prepare("SELECT id FROM meetings WHERE id = ? AND building_id = ?").bind(body.fulfilled_meeting_id, b.id).first();
    if (!m) throw new HttpError(400, "Vergadering niet gevonden");
  }
  // Het onderwerp van het verzoek is de reden van de bijeenroeping en komt dus op de agenda van die vergadering,
  // ingediend namens de mede-eigenaar die het verzoek startte. Nog geen vergadering → bestaand punt hergebruiken als het al geagendeerd was.
  let agendaItemId: string | null = null;
  if (body.status === "fulfilled") {
    const existing = req.agenda_item_id ? await c.env.DB.prepare("SELECT id FROM agenda_items WHERE id = ? AND meeting_id = ?").bind(req.agenda_item_id, body.fulfilled_meeting_id).first() : null;
    if (existing) agendaItemId = req.agenda_item_id;
    else {
      agendaItemId = uid();
      const pos = (await c.env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM agenda_items WHERE meeting_id = ?").bind(body.fulfilled_meeting_id).first<{ p: number }>())?.p ?? 0;
      await c.env.DB.prepare("INSERT INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status, position) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(agendaItemId, b.id, body.fulfilled_meeting_id, req.created_by, req.subject, [req.body, `Op verzoek van mede-eigenaars met minstens 1/5 van de aandelen (art. 3.87 §2 BW).`].filter(Boolean).join("\n\n"), body.required_majority ?? "simple", "scheduled", pos).run();
    }
  }
  await c.env.DB.prepare("UPDATE meeting_requests SET status = ?, fulfilled_meeting_id = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, agenda_item_id = COALESCE(?, agenda_item_id) WHERE id = ?")
    .bind(body.status, body.status === "fulfilled" ? body.fulfilled_meeting_id : null, now(), user.id, body.note ?? null, agendaItemId, req.id).run();
  await audit(c.env, b.id, user.id, body.status === "fulfilled" ? "meeting_request.fulfill" : "meeting_request.cancel", "meeting_request", req.id, { meeting_id: body.fulfilled_meeting_id ?? null });
  const signers = (await c.env.DB.prepare("SELECT user_id FROM meeting_request_signatures WHERE request_id = ?").bind(req.id).all<{ user_id: string }>()).results.map((r) => r.user_id).filter((id) => id !== user.id);
  if (signers.length) await notifyBuilding(c.env, { userIds: signers, buildingId: b.id, type: "meeting_request", title: body.status === "fulfilled" ? `Verzoek ingewilligd: ${req.subject}` : `Verzoek ingetrokken: ${req.subject}`, body: body.status === "fulfilled" ? `${user.name} heeft een algemene vergadering bijeengeroepen; het onderwerp staat op de agenda.` : `${user.name} heeft het verzoek ingetrokken.${body.note ? ` Reden: ${body.note}` : ""}`, link: `/b/${b.id}/meetings` });
  return c.json({ ok: true });
});

/** iCal-export van een vergadering. */
/** Ontvangst van de notulen per stemgerechtigde (bezorgd, geopend, als niet ontvangen gemeld). */
meetings.get("/:buildingId/meetings/:meetingId/minutes/receipts", requireBuilding(), async (c) => {
  const m = await managedMeeting(c);
  const rows = (await c.env.DB.prepare("SELECT r.user_id, u.name, r.delivered_at, r.opened_at, r.reported_missing_at FROM minutes_receipts r JOIN users u ON u.id = r.user_id WHERE r.meeting_id = ? ORDER BY u.name").bind(m.id).all()).results as any[];
  const missing = (await c.env.DB.prepare("SELECT r.user_id, u.name, r.reported_missing_at FROM minutes_receipts r JOIN users u ON u.id = r.user_id WHERE r.meeting_id = ? AND r.reported_missing_at IS NOT NULL").bind(m.id).all()).results;
  const due = new Date(new Date(m.starts_at).getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  return c.json({ due, sent_at: m.minutes_sent_at, late: m.minutes_sent_at ? m.minutes_sent_at.slice(0, 10) > due : new Date().toISOString().slice(0, 10) > due, rows, opened: rows.filter((r) => r.opened_at).length, total: rows.filter((r) => r.delivered_at).length, missing });
});
/** Een stemgerechtigde meldt dat hij de notulen niet (tijdig) ontving (art. 3.87 §12, lid 2): schriftelijk, gelogd, de syndicus wordt verwittigd. */
meetings.post("/:buildingId/meetings/:meetingId/minutes/not-received", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isCoOwner(b)) throw new HttpError(403, "Enkel stemgerechtigde mede-eigenaars ontvangen de notulen");
  const m = await c.env.DB.prepare("SELECT id, title, starts_at, minutes_status FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (new Date(m.starts_at) > new Date()) throw new HttpError(400, "De vergadering heeft nog niet plaatsgevonden");
  await c.env.DB.prepare("INSERT INTO minutes_receipts (meeting_id, user_id, reported_missing_at) VALUES (?,?,?) ON CONFLICT(meeting_id, user_id) DO UPDATE SET reported_missing_at = excluded.reported_missing_at").bind(m.id, user.id, now()).run();
  await audit(c.env, b.id, user.id, "minutes.not_received", "meeting", m.id);
  await notifyBuilding(c.env, { buildingId: b.id, type: "minutes", title: `Notulen niet ontvangen: ${m.title}`, body: `${user.name} meldt de notulen ${m.minutes_status === "final" ? "niet ontvangen te hebben" : "nog niet ontvangen te hebben"} (art. 3.87 §12 BW). Bezorg ze en registreer de verzending.`, link: `/b/${b.id}/meetings`, roles: ["syndicus"] });
  return c.json({ ok: true });
});

/** Bewoners zonder stemrecht dienen tot de aanvang schriftelijk vragen of opmerkingen over de gemeenschappelijke delen in (art. 3.89 §5, 6° BW). */
meetings.get("/:buildingId/meetings/:meetingId/questions", requireBuilding(), async (c) => {
  const rows = await c.env.DB.prepare("SELECT q.id, q.body, q.created_at, q.author_id, u.name AS author_name FROM meeting_questions q JOIN users u ON u.id = q.author_id WHERE q.meeting_id = ? AND q.building_id = ? ORDER BY q.created_at").bind(c.req.param("meetingId"), c.get("building").id).all();
  return c.json(rows.results);
});
meetings.post("/:buildingId/meetings/:meetingId/questions", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (b.role !== "huurder") throw new HttpError(403, "Deze vragen zijn bedoeld voor bewoners zonder stemrecht; mede-eigenaars dienen een agendapunt in of stellen hun vraag op de vergadering");
  const { body } = z.object({ body: z.string().min(5).max(3000) }).parse(await c.req.json());
  const m = await c.env.DB.prepare("SELECT id, title, starts_at, type, cancelled_at FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m || m.type === "raad") throw new HttpError(404, "Algemene vergadering niet gevonden");
  if (m.cancelled_at || new Date(m.starts_at) <= new Date()) throw new HttpError(400, "Vragen kunnen tot de aanvang van de vergadering ingediend worden");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO meeting_questions (id, building_id, meeting_id, author_id, body) VALUES (?,?,?,?,?)").bind(id, b.id, m.id, user.id, body).run();
  await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `Vraag van een bewoner voor ${m.title}`, body: `${user.name}: ${body.slice(0, 200)}`, link: `/b/${b.id}/meetings`, roles: ["syndicus"], email: false });
  return c.json({ id }, 201);
});
meetings.delete("/:buildingId/meetings/:meetingId/questions/:qid", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const q = await c.env.DB.prepare("SELECT q.author_id, m.starts_at FROM meeting_questions q JOIN meetings m ON m.id = q.meeting_id WHERE q.id = ? AND q.building_id = ?").bind(c.req.param("qid"), b.id).first<any>();
  if (!q) throw new HttpError(404, "Vraag niet gevonden");
  if (q.author_id !== user.id || new Date(q.starts_at) <= new Date()) throw new HttpError(403, "Enkel de indiener kan zijn vraag vóór de vergadering intrekken");
  await c.env.DB.prepare("DELETE FROM meeting_questions WHERE id = ?").bind(c.req.param("qid")).run();
  return c.json({ ok: true });
});
/** Mededeling voor de bewoners, aan te plakken in de gemeenschappelijke delen (art. 3.89 §5, 6°). */
meetings.post("/:buildingId/meetings/:meetingId/resident-notice", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await managedMeeting(c);
  const bld = await c.env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(b.id).first<any>();
  const when = new Date(m.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
  const pdf = await Pdf.create(`${bld.name} - Mededeling aan de bewoners`, pdfOpts(bld));
  pdf.title("Mededeling aan de bewoners");
  pdf.text(`De algemene vergadering van de vereniging van mede-eigenaars ${bld.name} vindt plaats op ${when}${m.location ? `, ${m.location}` : ""}.`, 12, { bold: true });
  pdf.space(8);
  pdf.text("Bewoont u het gebouw als huurder of op grond van een ander recht, zonder stemrecht in de algemene vergadering? Dan kunt u vóór de vergadering schriftelijk vragen of opmerkingen over de gemeenschappelijke delen indienen. Ze worden aan de vergadering meegedeeld (art. 3.89 §5, 6° BW).", 11);
  pdf.space(6);
  pdf.text(`Indienen: via het platform (${c.env.APP_URL}/b/${b.id}/meetings) of schriftelijk bij de syndicus${bld.syndicus_info ? (() => { const i = JSON.parse(bld.syndicus_info); return `: ${[i.name, i.address, i.email, i.phone].filter(Boolean).join(", ")}`; })() : ""}.`, 11);
  pdf.space(12);
  pdf.text("Aan te plakken op een goed zichtbare plaats in de gemeenschappelijke delen.", 8.5);
  const docId = await storeDocument(c.env, b.id, user.id, { name: `Mededeling bewoners ${m.title} ${m.starts_at.slice(0, 10)}.pdf`, bytes: await pdf.bytes(), mime: "application/pdf", category: "verslag_av", description: "Aan te plakken in de gemeenschappelijke delen (art. 3.89 §5, 6° BW)", folderMatch: /verslag/i });
  await c.env.DB.prepare("UPDATE meetings SET resident_notice_document_id = ? WHERE id = ?").bind(docId, m.id).run();
  await audit(c.env, b.id, user.id, "meeting.resident_notice", "meeting", m.id);
  return c.json({ document_id: docId }, 201);
});

meetings.get("/:buildingId/meetings/:meetingId/ics", requireBuilding(), async (c) => {
  const m = await c.env.DB.prepare("SELECT * FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), c.get("building").id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  const dt = (s: string) => s.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(m.starts_at); const end = new Date(start.getTime() + 2 * 3600_000);
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trustee//NL", "BEGIN:VEVENT", `UID:${m.id}@trustee`, `DTSTAMP:${dt(new Date().toISOString())}`, `DTSTART:${dt(start.toISOString())}`, `DTEND:${dt(end.toISOString())}`, `SUMMARY:${m.cancelled_at ? "GEANNULEERD: " : ""}${m.title}`, m.cancelled_at ? "STATUS:CANCELLED" : "STATUS:CONFIRMED", m.location ? `LOCATION:${m.location}` : "", m.agenda ? `DESCRIPTION:${m.agenda.replace(/\n/g, "\\n")}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="vergadering.ics"` } });
});

export default meetings;
