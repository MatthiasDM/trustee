import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { isBoard } from "../lib/auth";
import { attendance, majorityReached, MAJ, renderMinutesHtml, validateProxy } from "../lib/meeting";

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

meetings.get("/:buildingId/meetings", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare(
    `SELECT m.*, d.name AS minutes_name, ch.name AS chair_name, se.name AS secretary_name,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='attending') AS attending,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='proxy') AS proxy,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='absent') AS absent,
       (SELECT status FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.user_id = ?2) AS my_rsvp
     FROM meetings m LEFT JOIN documents d ON d.id = m.minutes_document_id LEFT JOIN users ch ON ch.id = m.chair_user_id LEFT JOIN users se ON se.id = m.secretary_user_id WHERE m.building_id = ?1 ORDER BY m.starts_at DESC`
  ).bind(b.id, c.get("user").id).all();
  return c.json(rows.results);
});

meetings.post("/:buildingId/meetings", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const body = schema.parse(await c.req.json());
  const id = uid();
  await c.env.DB.prepare("INSERT INTO meetings (id, building_id, title, type, starts_at, location, agenda, minutes_document_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, body.title, body.type, body.starts_at, body.location ?? null, body.agenda ?? null, body.minutes_document_id ?? null, user.id).run();
  await audit(c.env, b.id, user.id, "meeting.create", "meeting", id, { title: body.title });
  if (body.notify) {
    const when = new Date(body.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
    await notifyBuilding(c.env, { buildingId: b.id, type: "meeting", title: `Uitnodiging: ${body.title}`, body: `${when}${body.location ? ` — ${body.location}` : ""}. Laat weten of je aanwezig bent.`, link: `/b/${b.id}/meetings`, roles: body.type === "raad" ? ["syndicus", "raad", "commissaris"] : ["syndicus", "raad", "eigenaar", "commissaris"], excludeUserId: user.id });
  }
  return c.json({ id }, 201);
});

meetings.patch("/:buildingId/meetings/:meetingId", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const body = schema.partial().parse(await c.req.json());
  const { notify: _n, ...rest } = body;
  const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v]);
  if (fields.length) await c.env.DB.prepare(`UPDATE meetings SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("meetingId"), b.id).run();
  if (body.minutes_document_id) {
    const m = await c.env.DB.prepare("SELECT title FROM meetings WHERE id = ?").bind(c.req.param("meetingId")).first<any>();
    await notifyBuilding(c.env, { buildingId: b.id, type: "minutes", title: `Verslag beschikbaar: ${m?.title}`, body: "Het verslag van de vergadering staat online.", link: `/b/${b.id}/meetings`, excludeUserId: c.get("user").id });
  }
  return c.json({ ok: true });
});

meetings.delete("/:buildingId/meetings/:meetingId", requireBuilding("syndicus"), async (c) => {
  await c.env.DB.prepare("DELETE FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), c.get("building").id).run();
  return c.json({ ok: true });
});

meetings.put("/:buildingId/meetings/:meetingId/rsvp", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const { status, proxy_user_id } = z.object({ status: z.enum(["attending", "proxy", "absent"]), proxy_user_id: z.string().nullable().optional() }).parse(await c.req.json());
  const m = await c.env.DB.prepare("SELECT id FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (status === "proxy") { if (!proxy_user_id) throw new HttpError(400, "Kies wie je volmacht krijgt"); await validateProxy(c.env, b.id, c.req.param("meetingId"), user.id, proxy_user_id); }
  await c.env.DB.prepare("INSERT INTO meeting_rsvps (meeting_id, user_id, status, proxy_user_id, updated_at) VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(meeting_id, user_id) DO UPDATE SET status = excluded.status, proxy_user_id = excluded.proxy_user_id, updated_at = excluded.updated_at")
    .bind(c.req.param("meetingId"), user.id, status, status === "proxy" ? proxy_user_id ?? null : null).run();
  return c.json({ ok: true });
});

meetings.get("/:buildingId/meetings/:meetingId/rsvps", requireBuilding("syndicus", "raad"), async (c) => {
  const rows = await c.env.DB.prepare("SELECT r.status, r.updated_at, u.name, u.email, pu.name AS proxy_name FROM meeting_rsvps r JOIN users u ON u.id = r.user_id LEFT JOIN users pu ON pu.id = r.proxy_user_id WHERE r.meeting_id = ? ORDER BY r.status, u.name").bind(c.req.param("meetingId")).all();
  return c.json(rows.results);
});

/** Aanwezigheid per kavel en quorum. Leden zien de telling; de lijst met namen is voor syndicus en raad. */
meetings.get("/:buildingId/meetings/:meetingId/attendance", requireBuilding(), async (c) => {
  const b = c.get("building");
  const m = await c.env.DB.prepare("SELECT id FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  const a = await attendance(c.env, b.id, c.req.param("meetingId"));
  return c.json(isBoard(b.role) ? a : { quorum: a.quorum, rows: [] });
});

/** Stemgerechtigde leden (voor volmachten): mede-eigenaars, niet de syndicus, niet huurders. */
meetings.get("/:buildingId/meetings/:meetingId/proxy-candidates", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const rows = (await c.env.DB.prepare("SELECT bm.user_id, u.name, (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = ? AND r.status = 'proxy' AND r.proxy_user_id = bm.user_id) AS proxies FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.role NOT IN ('syndicus','huurder') AND bm.user_id != ? ORDER BY u.name").bind(c.req.param("meetingId"), b.id, user.id).all()).results;
  return c.json(rows);
});

/**
 * Stemming per agendapunt tijdens de AV registreren (syndicus/raad): keuze per kavel, gewogen naar aandelen.
 * Onthoudingen tellen niet mee voor de meerderheid (art. 3.88 §1). Namen van tegenstemmers worden bewaard voor de notulen (art. 3.87 §12).
 */
meetings.post("/:buildingId/meetings/:meetingId/agenda/:itemId/vote", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const item = await c.env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ? AND building_id = ?").bind(c.req.param("itemId"), c.req.param("meetingId"), b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden op deze vergadering");
  const { votes, decision } = z.object({ votes: z.array(z.object({ unit_id: z.string(), choice: z.enum(["for", "against", "abstain", "absent"]) })), decision: z.string().max(3000).optional() }).parse(await c.req.json());
  const units = (await c.env.DB.prepare("SELECT un.id, un.label, un.shares, (SELECT GROUP_CONCAT(u.name, ', ') FROM unit_owners uo JOIN users u ON u.id = uo.user_id WHERE uo.unit_id = un.id) AS owners FROM units un WHERE un.building_id = ?").bind(b.id).all()).results as any[];
  const eligible = units.filter((u) => u.owners).reduce((s, u) => s + u.shares, 0);
  let vf = 0, va = 0, vab = 0, nf = 0, na = 0, nab = 0; const dissenters: string[] = [];
  for (const v of votes) { const u = units.find((x) => x.id === v.unit_id); if (!u) continue; if (v.choice === "for") { vf += u.shares; nf++; } else if (v.choice === "against") { va += u.shares; na++; if (u.owners) dissenters.push(`${u.owners} (kavel ${u.label})`); } else if (v.choice === "abstain") { vab += u.shares; nab++; } }
  const res = majorityReached(item.required_majority, vf, va, eligible);
  const text = decision ?? `${res.reached ? "Goedgekeurd" : "Verworpen"} met ${vf} aandelen vóór, ${va} tegen en ${vab} onthoudingen (${MAJ[item.required_majority]?.label ?? item.required_majority}${item.required_majority !== "none" && item.required_majority !== "unanimous" ? `, ${(res.pct * 100).toFixed(1)} % van de uitgebrachte stemmen` : ""}).`;
  await c.env.DB.prepare("UPDATE agenda_items SET votes_for = ?, votes_against = ?, votes_abstain = ?, voters_for = ?, voters_against = ?, voters_abstain = ?, dissenters = ?, vote_detail = ?, voted_at = ?, status = 'decided', decision = ?, updated_at = ? WHERE id = ?")
    .bind(vf, va, vab, nf, na, nab, JSON.stringify(dissenters), JSON.stringify(votes), new Date().toISOString(), text, new Date().toISOString(), item.id).run();
  await audit(c.env, b.id, user.id, "agenda.vote", "agenda_item", item.id, { for: vf, against: va, abstain: vab, reached: res.reached });
  return c.json({ ok: true, reached: res.reached, pct: res.pct, decision: text, dissenters });
});

/** Ontwerp van de notulen genereren uit vergadering, aanwezigheid en agendapunten. */
meetings.post("/:buildingId/meetings/:meetingId/minutes/generate", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
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
  for (const r of a.rows) L.push(`- Kavel ${r.label} (${r.shares} aandelen) — ${r.owner_names || "geen eigenaar geregistreerd"}: ${r.status === "attending" ? "aanwezig" : r.status === "proxy" ? `vertegenwoordigd bij volmacht door ${r.holder_name}` : r.status === "absent" ? "afwezig" : "niet gemeld"}`);
  L.push(`Aanwezig of vertegenwoordigd: ${a.quorum.present_owners} van ${a.quorum.total_owners} mede-eigenaars, ${a.quorum.present_shares} van ${a.quorum.total_shares} aandelen. ${a.quorum.explanation}`, "");
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

meetings.patch("/:buildingId/meetings/:meetingId/minutes", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const { body } = z.object({ body: z.string().max(200000) }).parse(await c.req.json());
  const m = await c.env.DB.prepare("SELECT minutes_status FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  if (m.minutes_status === "final") throw new HttpError(400, "De notulen zijn al definitief");
  await c.env.DB.prepare("UPDATE meetings SET minutes_status = 'draft', minutes_body = ? WHERE id = ?").bind(body, c.req.param("meetingId")).run();
  return c.json({ ok: true });
});

/** Notulen definitief maken: document in Documenten (Verslagen AV), koppelen, verzenden aan alle stemgerechtigden (art. 3.87 §12: binnen 30 dagen). */
meetings.post("/:buildingId/meetings/:meetingId/minutes/finalize", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await c.env.DB.prepare("SELECT * FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), b.id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
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
  return c.json({ ok: true, documentId: docId });
});

/** iCal-export van een vergadering. */
meetings.get("/:buildingId/meetings/:meetingId/ics", requireBuilding(), async (c) => {
  const m = await c.env.DB.prepare("SELECT * FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), c.get("building").id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  const dt = (s: string) => s.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(m.starts_at); const end = new Date(start.getTime() + 2 * 3600_000);
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trustee//NL", "BEGIN:VEVENT", `UID:${m.id}@trustee`, `DTSTAMP:${dt(new Date().toISOString())}`, `DTSTART:${dt(start.toISOString())}`, `DTEND:${dt(end.toISOString())}`, `SUMMARY:${m.title}`, m.location ? `LOCATION:${m.location}` : "", m.agenda ? `DESCRIPTION:${m.agenda.replace(/\n/g, "\\n")}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="vergadering.ics"` } });
});

export default meetings;
