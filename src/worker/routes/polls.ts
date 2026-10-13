import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, isManager, isOwner, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

const polls = new Hono<AppEnv>();
polls.use("*", requireAuth);

/** Stemgewicht van een gebruiker = som(quotiteit kavel × eigendomsaandeel). */
async function voteWeight(db: D1Database, buildingId: string, userId: string): Promise<number> {
  const r = await db.prepare("SELECT COALESCE(SUM(un.shares * uo.share_pct / 100.0), 0) AS w FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE un.building_id = ? AND uo.user_id = ?").bind(buildingId, userId).first<{ w: number }>();
  return r?.w ?? 0;
}

async function pollWithResults(c: Context<AppEnv>, pollId: string) {
  const b = c.get("building");
  const user = c.get("user");
  const poll = await c.env.DB.prepare("SELECT p.*, u.name AS created_by_name FROM polls p JOIN users u ON u.id = p.created_by WHERE p.id = ? AND p.building_id = ?").bind(pollId, b.id).first<any>();
  if (!poll) throw new HttpError(404, "Stemming niet gevonden");
  const options = (await c.env.DB.prepare("SELECT id, label, position FROM poll_options WHERE poll_id = ? ORDER BY position").bind(pollId).all()).results as any[];
  const votes = (await c.env.DB.prepare("SELECT v.option_id, v.user_id, v.weight, u.name FROM poll_votes v JOIN users u ON u.id = v.user_id WHERE v.poll_id = ?").bind(pollId).all()).results as any[];
  const closed = poll.status === "closed" || (poll.closes_at && poll.closes_at < now());
  const showResults = closed || isBoard(b.role) || votes.some((v) => v.user_id === user.id);
  for (const o of options) {
    const ov = votes.filter((v) => v.option_id === o.id);
    o.votes = showResults ? ov.length : undefined;
    o.weight = showResults ? ov.reduce((s, v) => s + v.weight, 0) : undefined;
    o.voters = showResults && !poll.anonymous ? ov.map((v) => v.name) : undefined;
  }
  const voterIds = new Set(votes.map((v) => v.user_id));
  const totalWeight = [...voterIds].reduce((s, id) => s + (votes.find((v) => v.user_id === id)?.weight ?? 0), 0);
  const eligible = poll.owners_only
    ? await c.env.DB.prepare("SELECT COUNT(DISTINCT bm.user_id) AS n, COALESCE((SELECT SUM(shares) FROM units WHERE building_id = ?1 AND id IN (SELECT unit_id FROM unit_owners)),0) AS w FROM building_members bm WHERE bm.building_id = ?1 AND bm.role != 'huurder'").bind(b.id).first<any>()
    : await c.env.DB.prepare("SELECT COUNT(*) AS n, COUNT(*) AS w FROM building_members WHERE building_id = ?").bind(b.id).first<any>();
  return {
    ...poll,
    status: closed ? "closed" : poll.status,
    options,
    my_votes: votes.filter((v) => v.user_id === user.id).map((v) => v.option_id),
    total_voters: voterIds.size,
    total_weight: totalWeight,
    eligible_voters: eligible?.n ?? 0,
    eligible_weight: poll.weighted ? (eligible?.w ?? b.total_shares) : (eligible?.n ?? 0),
    can_vote: !closed && poll.status === "open" && (!poll.owners_only || isOwner(b.role)),
  };
}

polls.get("/:buildingId/polls", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.weighted, p.anonymous, p.multiple, p.owners_only, p.required_majority, p.opens_at, p.closes_at,
            CASE WHEN p.status='closed' OR (p.closes_at IS NOT NULL AND p.closes_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 'closed' ELSE p.status END AS status,
            p.created_at, u.name AS created_by_name,
            (SELECT COUNT(DISTINCT user_id) FROM poll_votes WHERE poll_id = p.id) AS total_voters,
            EXISTS(SELECT 1 FROM poll_votes WHERE poll_id = p.id AND user_id = ?2) AS voted
     FROM polls p JOIN users u ON u.id = p.created_by WHERE p.building_id = ?1 ${isBoard(b.role) ? "" : "AND p.status != 'draft'"} ORDER BY p.created_at DESC`
  ).bind(b.id, user.id).all();
  return c.json(rows.results);
});

const pollSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(10000).optional().nullable(),
  options: z.array(z.string().min(1).max(200)).min(2).max(20),
  weighted: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  multiple: z.boolean().default(false),
  owners_only: z.boolean().default(true),
  required_majority: z.enum(["simple", "two_thirds", "four_fifths", "unanimous", "none"]).default("simple"),
  closes_at: z.string().datetime().optional().nullable(),
  status: z.enum(["draft", "open"]).default("open"),
});

polls.post("/:buildingId/polls", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const body = pollSchema.parse(await c.req.json());
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO polls (id, building_id, created_by, title, description, weighted, anonymous, multiple, owners_only, required_majority, closes_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, b.id, user.id, body.title, body.description ?? null, +body.weighted, +body.anonymous, +body.multiple, +body.owners_only, body.required_majority, body.closes_at ?? null, body.status),
    ...body.options.map((label, i) => c.env.DB.prepare("INSERT INTO poll_options (id, poll_id, label, position) VALUES (?,?,?,?)").bind(uid(), id, label, i)),
  ]);
  await audit(c.env, b.id, user.id, "poll.create", "poll", id, { title: body.title });
  if (body.status === "open") {
    await notifyBuilding(c.env, { buildingId: b.id, type: "poll", title: `Nieuwe stemming: ${body.title}`, body: body.closes_at ? `Stemmen kan tot ${new Date(body.closes_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels" })}.` : "Breng nu je stem uit.", link: `/b/${b.id}/polls/${id}`, roles: body.owners_only ? ["syndicus", "raad", "eigenaar", "commissaris"] : undefined, excludeUserId: user.id });
  }
  return c.json({ id }, 201);
});

polls.get("/:buildingId/polls/:pollId", requireBuilding(), async (c) => c.json(await pollWithResults(c, c.req.param("pollId"))));

polls.patch("/:buildingId/polls/:pollId", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const body = z.object({ status: z.enum(["draft", "open", "closed"]).optional(), closes_at: z.string().datetime().nullable().optional(), title: z.string().min(3).max(200).optional(), description: z.string().max(10000).nullable().optional() }).parse(await c.req.json());
  const poll = await c.env.DB.prepare("SELECT * FROM polls WHERE id = ? AND building_id = ?").bind(c.req.param("pollId"), b.id).first<any>();
  if (!poll) throw new HttpError(404, "Stemming niet gevonden");
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE polls SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, v]) => v), poll.id).run();
  if (body.status === "open" && poll.status === "draft") {
    await notifyBuilding(c.env, { buildingId: b.id, type: "poll", title: `Nieuwe stemming: ${body.title ?? poll.title}`, body: "Breng nu je stem uit.", link: `/b/${b.id}/polls/${poll.id}`, excludeUserId: c.get("user").id });
  }
  if (body.status === "closed" && poll.status !== "closed") {
    await notifyBuilding(c.env, { buildingId: b.id, type: "poll_closed", title: `Stemming afgesloten: ${poll.title}`, body: "Bekijk de resultaten.", link: `/b/${b.id}/polls/${poll.id}`, email: false });
  }
  return c.json({ ok: true });
});

polls.delete("/:buildingId/polls/:pollId", requireBuilding("syndicus"), async (c) => {
  await c.env.DB.prepare("DELETE FROM polls WHERE id = ? AND building_id = ?").bind(c.req.param("pollId"), c.get("building").id).run();
  return c.json({ ok: true });
});

polls.post("/:buildingId/polls/:pollId/vote", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const { option_ids } = z.object({ option_ids: z.array(z.string()).min(1).max(20) }).parse(await c.req.json());
  const poll = await c.env.DB.prepare("SELECT * FROM polls WHERE id = ? AND building_id = ?").bind(c.req.param("pollId"), b.id).first<any>();
  if (!poll) throw new HttpError(404, "Stemming niet gevonden");
  if (poll.status !== "open" || (poll.closes_at && poll.closes_at < now())) throw new HttpError(400, "Deze stemming is gesloten");
  if (poll.owners_only && !isOwner(b.role)) throw new HttpError(403, "Enkel mede-eigenaars mogen stemmen");
  if (!poll.multiple && option_ids.length > 1) throw new HttpError(400, "Slechts één keuze toegestaan");
  const valid = (await c.env.DB.prepare("SELECT id FROM poll_options WHERE poll_id = ?").bind(poll.id).all<{ id: string }>()).results.map((o) => o.id);
  if (option_ids.some((o) => !valid.includes(o))) throw new HttpError(400, "Ongeldige optie");
  let weight = 1;
  if (poll.weighted) {
    weight = await voteWeight(c.env.DB, b.id, user.id);
    if (weight <= 0 && !isManager(b.role)) throw new HttpError(403, "Je hebt geen kavels (quotiteiten) in dit gebouw en kan niet gewogen stemmen");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?").bind(poll.id, user.id),
    ...option_ids.map((o) => c.env.DB.prepare("INSERT INTO poll_votes (id, poll_id, option_id, user_id, weight) VALUES (?,?,?,?,?)").bind(uid(), poll.id, o, user.id, weight)),
  ]);
  return c.json(await pollWithResults(c, poll.id));
});

/** Export van de stemresultaten als CSV (syndicus/raad). */
polls.get("/:buildingId/polls/:pollId/export.csv", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const p = await pollWithResults(c, c.req.param("pollId"));
  const lines = ["optie;stemmen;gewicht;percentage"];
  for (const o of p.options) lines.push(`"${o.label.replace(/"/g, '""')}";${o.votes ?? 0};${(o.weight ?? 0).toFixed(2)};${p.total_weight ? (((o.weight ?? 0) / p.total_weight) * 100).toFixed(1) : "0"}%`);
  lines.push("", `totaal stemmers;${p.total_voters};gewicht;${p.total_weight.toFixed(2)}`, `stemgerechtigd;${p.eligible_voters};gewicht;${p.eligible_weight}`);
  return new Response("﻿" + lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="stemming-${p.id}.csv"` } });
});

export default polls;
