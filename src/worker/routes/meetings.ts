import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

const meetings = new Hono<AppEnv>();
meetings.use("*", requireAuth);

const schema = z.object({
  title: z.string().min(3).max(200),
  type: z.enum(["av", "bav", "raad"]).default("av"),
  starts_at: z.string().datetime(),
  location: z.string().max(300).optional().nullable(),
  agenda: z.string().max(20000).optional().nullable(),
  minutes_document_id: z.string().nullable().optional(),
  notify: z.boolean().default(true),
});

meetings.get("/:buildingId/meetings", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare(
    `SELECT m.*, d.name AS minutes_name,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='attending') AS attending,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='proxy') AS proxy,
       (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.status='absent') AS absent,
       (SELECT status FROM meeting_rsvps r WHERE r.meeting_id = m.id AND r.user_id = ?2) AS my_rsvp
     FROM meetings m LEFT JOIN documents d ON d.id = m.minutes_document_id WHERE m.building_id = ?1 ORDER BY m.starts_at DESC`
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
  const fields = Object.entries(rest).filter(([, v]) => v !== undefined);
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
  await c.env.DB.prepare("INSERT INTO meeting_rsvps (meeting_id, user_id, status, proxy_user_id, updated_at) VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(meeting_id, user_id) DO UPDATE SET status = excluded.status, proxy_user_id = excluded.proxy_user_id, updated_at = excluded.updated_at")
    .bind(c.req.param("meetingId"), user.id, status, status === "proxy" ? proxy_user_id ?? null : null).run();
  return c.json({ ok: true });
});

meetings.get("/:buildingId/meetings/:meetingId/rsvps", requireBuilding("syndicus", "raad"), async (c) => {
  const rows = await c.env.DB.prepare("SELECT r.status, r.updated_at, u.name, u.email, pu.name AS proxy_name FROM meeting_rsvps r JOIN users u ON u.id = r.user_id LEFT JOIN users pu ON pu.id = r.proxy_user_id WHERE r.meeting_id = ? ORDER BY r.status, u.name").bind(c.req.param("meetingId")).all();
  return c.json(rows.results);
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
