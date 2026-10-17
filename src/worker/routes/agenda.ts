import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, isCoOwner, requireAuth, requireBuilding } from "../lib/auth";
import { canManageMeeting } from "../lib/governance";
import { HttpError, now, patchOf, uid } from "../lib/util";
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
  // namen bij een belangenconflict (art. 3.87 §9)
  const cids = [...new Set((rows.results as any[]).flatMap((r) => r.conflict_user_ids ? JSON.parse(r.conflict_user_ids) as string[] : []))];
  const cnames: Record<string, string> = {};
  if (cids.length) for (const u of (await c.env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${cids.map(() => "?").join(",")})`).bind(...cids).all<{ id: string; name: string }>()).results) cnames[u.id] = u.name;
  for (const r of rows.results as any[]) { r.conflict_user_ids = r.conflict_user_ids ? JSON.parse(r.conflict_user_ids) : []; r.conflict_names = r.conflict_user_ids.map((id: string) => cnames[id] ?? id); r.vote_adjustments = r.vote_adjustments ? JSON.parse(r.vote_adjustments) : null; }
  const info = await c.env.DB.prepare("SELECT av_period_start FROM buildings WHERE id = ?").bind(b.id).first<{ av_period_start: string | null }>();
  return c.json({ items: rows.results, ...agendaDeadline(info?.av_period_start ?? null) });
});

const itemSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(10000).optional().nullable(),
  required_majority: z.enum(["simple", "two_thirds", "four_fifths", "unanimous", "none"]).default("simple"),
  meeting_id: z.string().nullable().optional(),
  kind: z.enum(["general", "works", "statutes", "demolition", "other"]).default("general"),
});

/** Elke mede-eigenaar kan een agendapunt indienen (art. 3.87 §3). */
agenda.post("/:buildingId/agenda", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isCoOwner(b) && !["syndicus", "raad"].includes(b.role)) throw new HttpError(403, "Enkel mede-eigenaars kunnen agendapunten indienen; de syndicus en de raad agenderen zelf");
  const body = itemSchema.parse(await c.req.json());
  const id = uid();
  const targetMeeting = body.meeting_id ? await c.env.DB.prepare("SELECT convened_by_owners, created_by FROM meetings WHERE id = ? AND building_id = ?").bind(body.meeting_id, b.id).first<any>() : null;
  const scheduled = !!body.meeting_id && (isBoard(b.role) || (!!targetMeeting && canManageMeeting(b, user.id, targetMeeting)));
  await c.env.DB.prepare("INSERT INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status, kind) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, scheduled ? body.meeting_id : null, user.id, body.title, body.description ?? null, body.required_majority, scheduled ? "scheduled" : "proposed", body.kind).run();
  await audit(c.env, b.id, user.id, "agenda.propose", "agenda_item", id, { title: body.title });
  if (!scheduled) await notifyBuilding(c.env, { buildingId: b.id, type: "agenda", title: `Nieuw agendapunt voorgesteld: ${body.title}`, body: `${user.name} stelt een punt voor de volgende algemene vergadering voor.`, link: `/b/${b.id}/meetings`, roles: ["syndicus", "raad"], excludeUserId: user.id, email: false });
  return c.json({ id }, 201);
});

agenda.patch("/:buildingId/agenda/:itemId", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const item = await c.env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND building_id = ?").bind(c.req.param("itemId"), b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden");
  const body = patchOf(itemSchema.partial().extend({
    status: z.enum(["proposed", "scheduled", "decided", "deferred", "withdrawn"]).optional(),
    position: z.number().int().optional(),
    decision: z.string().max(5000).nullable().optional(),
    conflict_user_ids: z.array(z.string()).max(50).nullable().optional(),
    conflict_reason: z.string().max(1000).nullable().optional(),
    charge_key_id: z.string().nullable().optional(),
  }), await c.req.json());
  if (body.charge_key_id) { const k = await c.env.DB.prepare("SELECT 1 FROM cost_keys WHERE id = ? AND building_id = ?").bind(body.charge_key_id, b.id).first(); if (!k) throw new HttpError(400, "Verdeelsleutel niet gevonden"); }
  if (body.conflict_user_ids !== undefined) (body as any).conflict_user_ids = body.conflict_user_ids?.length ? JSON.stringify([...new Set(body.conflict_user_ids)]) : null;
  const isAuthor = item.submitted_by === user.id;
  // wie een vergadering wettig zelf bijeenriep, beheert ook haar agenda
  const targetId = body.meeting_id ?? item.meeting_id;
  const target = targetId ? await c.env.DB.prepare("SELECT convened_by_owners, created_by FROM meetings WHERE id = ? AND building_id = ?").bind(targetId, b.id).first<any>() : null;
  const managesTarget = !!target && canManageMeeting(b, user.id, target);
  if (!isBoard(b.role) && !managesTarget) {
    // indiener mag enkel eigen, nog niet geagendeerd punt aanpassen of intrekken
    if (!isAuthor || item.status !== "proposed") throw new HttpError(403, "Geen rechten");
    if (body.status && body.status !== "withdrawn") throw new HttpError(403, "Je kan enkel intrekken");
    delete body.meeting_id; delete body.position; delete body.decision; delete (body as any).conflict_user_ids; delete body.conflict_reason; delete body.charge_key_id;
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
agenda.post("/:buildingId/agenda/:itemId/poll", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const item = await c.env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND building_id = ?").bind(c.req.param("itemId"), b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden");
  if (!isBoard(b.role)) {
    const mt = item.meeting_id ? await c.env.DB.prepare("SELECT convened_by_owners, created_by FROM meetings WHERE id = ?").bind(item.meeting_id).first<any>() : null;
    if (!mt || !canManageMeeting(b, user.id, mt)) throw new HttpError(403, "Onvoldoende rechten");
  }
  if (item.poll_id) throw new HttpError(400, "Er is al een stemming gekoppeld");
  const body = z.object({ options: z.array(z.string().min(1)).min(2).default(["Voor", "Tegen", "Onthouding"]), closes_at: z.string().datetime().nullable().optional(), anonymous: z.boolean().default(false), status: z.enum(["draft", "open"]).default("open"), document_ids: z.array(z.string()).max(20).default([]) }).parse(await c.req.json().catch(() => ({})));
  const pollId = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO polls (id, building_id, created_by, title, description, weighted, anonymous, multiple, owners_only, required_majority, closes_at, status) VALUES (?,?,?,?,?,1,?,0,1,?,?,?)")
      .bind(pollId, b.id, user.id, item.title, item.description ?? null, +body.anonymous, item.required_majority, body.closes_at ?? null, body.status),
    ...body.options.map((label, i) => c.env.DB.prepare("INSERT INTO poll_options (id, poll_id, label, position) VALUES (?,?,?,?)").bind(uid(), pollId, label, i)),
    c.env.DB.prepare("UPDATE agenda_items SET poll_id = ?, updated_at = ? WHERE id = ?").bind(pollId, now(), item.id),
  ]);
  if (body.document_ids.length) {
    const ids = [...new Set(body.document_ids)];
    const found = (await c.env.DB.prepare(`SELECT id FROM documents WHERE building_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(b.id, ...ids).all<{ id: string }>()).results.map((r) => r.id);
    await c.env.DB.batch(found.map((d, i) => c.env.DB.prepare("INSERT INTO poll_documents (poll_id, document_id, position) VALUES (?,?,?)").bind(pollId, d, i)));
  }
  await audit(c.env, b.id, user.id, "agenda.poll", "agenda_item", item.id, { pollId });
  if (body.status === "open") await notifyBuilding(c.env, { buildingId: b.id, type: "poll", title: `Stemming over agendapunt: ${item.title}`, body: "Breng je stem uit.", link: `/b/${b.id}/polls/${pollId}`, roles: ["syndicus", "raad", "eigenaar", "commissaris"], excludeUserId: user.id });
  return c.json({ pollId }, 201);
});

export default agenda;
