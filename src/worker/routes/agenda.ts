import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, isOwner, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

const agenda = new Hono<AppEnv>();
agenda.use("*", requireAuth);

/** Berekent de uiterste indiendatum (3 weken vóór de start van de AV-periode, art. 3.87 §3). */
export function agendaDeadline(avPeriodStart: string | null): { deadline: string | null; periodStart: string | null } {
  if (!avPeriodStart) return { deadline: null, periodStart: null };
  const [mm, dd] = avPeriodStart.split("-").map(Number);
  const today = new Date();
  let start = new Date(Date.UTC(today.getUTCFullYear(), mm - 1, dd));
  if (start.getTime() < today.getTime() - 86400_000) start = new Date(Date.UTC(today.getUTCFullYear() + 1, mm - 1, dd));
  const deadline = new Date(start.getTime() - 21 * 86400_000);
  return { deadline: deadline.toISOString(), periodStart: start.toISOString() };
}

agenda.get("/:buildingId/agenda", requireBuilding(), async (c) => {
  const b = c.get("building");
  const meetingId = c.req.query("meeting");
  const conds = ["a.building_id = ?"]; const params: unknown[] = [b.id];
  if (meetingId === "none") conds.push("a.meeting_id IS NULL");
  else if (meetingId) { conds.push("a.meeting_id = ?"); params.push(meetingId); }
  const rows = await c.env.DB.prepare(
    `SELECT a.*, u.name AS submitted_by_name, m.title AS meeting_title, m.starts_at AS meeting_starts_at,
            p.status AS poll_status
     FROM agenda_items a JOIN users u ON u.id = a.submitted_by LEFT JOIN meetings m ON m.id = a.meeting_id LEFT JOIN polls p ON p.id = a.poll_id
     WHERE ${conds.join(" AND ")} ORDER BY CASE a.status WHEN 'proposed' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, a.position, a.created_at`
  ).bind(...params).all();
  const info = await c.env.DB.prepare("SELECT av_period_start FROM buildings WHERE id = ?").bind(b.id).first<{ av_period_start: string | null }>();
  return c.json({ items: rows.results, ...agendaDeadline(info?.av_period_start ?? null) });
});

const itemSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(10000).optional().nullable(),
  required_majority: z.enum(["simple", "two_thirds", "four_fifths", "unanimous", "none"]).default("simple"),
  meeting_id: z.string().nullable().optional(),
});

/** Elke mede-eigenaar kan een agendapunt indienen (art. 3.87 §3). */
agenda.post("/:buildingId/agenda", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isOwner(b.role)) throw new HttpError(403, "Enkel mede-eigenaars kunnen agendapunten indienen");
  const body = itemSchema.parse(await c.req.json());
  const id = uid();
  const scheduled = !!body.meeting_id && isBoard(b.role);
  await c.env.DB.prepare("INSERT INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, b.id, scheduled ? body.meeting_id : null, user.id, body.title, body.description ?? null, body.required_majority, scheduled ? "scheduled" : "proposed").run();
  await audit(c.env, b.id, user.id, "agenda.propose", "agenda_item", id, { title: body.title });
  if (!scheduled) await notifyBuilding(c.env, { buildingId: b.id, type: "agenda", title: `Nieuw agendapunt voorgesteld: ${body.title}`, body: `${user.name} stelt een punt voor de volgende algemene vergadering voor.`, link: `/b/${b.id}/meetings`, roles: ["syndicus", "raad"], excludeUserId: user.id, email: false });
  return c.json({ id }, 201);
});

agenda.patch("/:buildingId/agenda/:itemId", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const item = await c.env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND building_id = ?").bind(c.req.param("itemId"), b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden");
  const body = itemSchema.partial().extend({
    status: z.enum(["proposed", "scheduled", "decided", "deferred", "withdrawn"]).optional(),
    position: z.number().int().optional(),
    decision: z.string().max(5000).nullable().optional(),
  }).parse(await c.req.json());
  const isAuthor = item.submitted_by === user.id;
  if (!isBoard(b.role)) {
    // indiener mag enkel eigen, nog niet geagendeerd punt aanpassen of intrekken
    if (!isAuthor || item.status !== "proposed") throw new HttpError(403, "Geen rechten");
    if (body.status && body.status !== "withdrawn") throw new HttpError(403, "Je kan enkel intrekken");
    delete body.meeting_id; delete body.position; delete body.decision;
  }
  if (body.meeting_id !== undefined && body.status === undefined) body.status = body.meeting_id ? "scheduled" : "proposed";
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE agenda_items SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...fields.map(([, v]) => v), now(), item.id).run();
  if (body.meeting_id && item.meeting_id !== body.meeting_id && !isAuthor) {
    await notifyBuilding(c.env, { buildingId: b.id, type: "agenda", title: `Je agendapunt is geagendeerd: ${item.title}`, link: `/b/${b.id}/meetings`, userIds: [item.submitted_by], email: false });
  }
  return c.json({ ok: true });
});

agenda.delete("/:buildingId/agenda/:itemId", requireBuilding("syndicus", "raad"), async (c) => {
  await c.env.DB.prepare("DELETE FROM agenda_items WHERE id = ? AND building_id = ?").bind(c.req.param("itemId"), c.get("building").id).run();
  return c.json({ ok: true });
});

/** Maakt een stemming aan vanuit een agendapunt en koppelt ze. */
agenda.post("/:buildingId/agenda/:itemId/poll", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const item = await c.env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND building_id = ?").bind(c.req.param("itemId"), b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden");
  if (item.poll_id) throw new HttpError(400, "Er is al een stemming gekoppeld");
  const body = z.object({ options: z.array(z.string().min(1)).min(2).default(["Voor", "Tegen", "Onthouding"]), closes_at: z.string().datetime().nullable().optional(), anonymous: z.boolean().default(false), status: z.enum(["draft", "open"]).default("open") }).parse(await c.req.json().catch(() => ({})));
  const pollId = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO polls (id, building_id, created_by, title, description, weighted, anonymous, multiple, owners_only, required_majority, closes_at, status) VALUES (?,?,?,?,?,1,?,0,1,?,?,?)")
      .bind(pollId, b.id, user.id, item.title, item.description ?? null, +body.anonymous, item.required_majority, body.closes_at ?? null, body.status),
    ...body.options.map((label, i) => c.env.DB.prepare("INSERT INTO poll_options (id, poll_id, label, position) VALUES (?,?,?,?)").bind(uid(), pollId, label, i)),
    c.env.DB.prepare("UPDATE agenda_items SET poll_id = ?, updated_at = ? WHERE id = ?").bind(pollId, now(), item.id),
  ]);
  await audit(c.env, b.id, user.id, "agenda.poll", "agenda_item", item.id, { pollId });
  if (body.status === "open") await notifyBuilding(c.env, { buildingId: b.id, type: "poll", title: `Stemming over agendapunt: ${item.title}`, body: "Breng je stem uit.", link: `/b/${b.id}/polls/${pollId}`, roles: ["syndicus", "raad", "eigenaar", "commissaris"], excludeUserId: user.id });
  return c.json({ pollId }, 201);
});

export default agenda;
