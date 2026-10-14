import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, isManager, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

const posts = new Hono<AppEnv>();
posts.use("*", requireAuth);

function postVisibility(role: string, userId: string) {
  // privé-meldingen aan de syndicus zijn enkel zichtbaar voor syndicus en auteur
  return isManager(role) ? "1=1" : `(p.visibility = 'all' OR p.author_id = '${userId.replace(/'/g, "")}')`;
}

posts.get("/:buildingId/posts", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const type = c.req.query("type");
  const status = c.req.query("status");
  const conds = ["p.building_id = ?", postVisibility(b.role, user.id)];
  const params: unknown[] = [b.id];
  if (type) { conds.push("p.type = ?"); params.push(type); }
  if (status) { conds.push("p.status = ?"); params.push(status); }
  const rows = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, bm.role AS author_role, s.name AS supplier_name,
            (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comment_count
     FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN building_members bm ON bm.user_id = p.author_id AND bm.building_id = p.building_id LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE ${conds.join(" AND ")} ORDER BY p.pinned DESC, p.updated_at DESC LIMIT 300`
  ).bind(...params).all();
  return c.json(rows.results);
});

const postSchema = z.object({
  type: z.enum(["question", "announcement", "incident"]).default("question"),
  title: z.string().min(3).max(200),
  body: z.string().min(1).max(20000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  visibility: z.enum(["all", "syndicus"]).default("all"),
  pinned: z.boolean().default(false),
  attachments: z.array(z.string()).max(10).default([]),
});

posts.post("/:buildingId/posts", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const body = postSchema.extend({ location: z.string().max(120).nullable().optional() }).parse(await c.req.json());
  if (body.type === "announcement" && !isBoard(b.role)) throw new HttpError(403, "Enkel de syndicus of raad kan mededelingen plaatsen");
  if (body.pinned && !isManager(b.role)) body.pinned = false;
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO posts (id, building_id, author_id, type, title, body, priority, visibility, pinned, location) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, b.id, user.id, body.type, body.title, body.body, body.priority, body.visibility, +body.pinned, body.location ?? null),
    ...body.attachments.map((d) => c.env.DB.prepare("INSERT OR IGNORE INTO post_attachments (post_id, document_id) VALUES (?, ?)").bind(id, d)),
  ]);
  await audit(c.env, b.id, user.id, `post.create.${body.type}`, "post", id, { title: body.title });
  const link = `/b/${b.id}/posts/${id}`;
  const labels = { question: "Nieuwe vraag", announcement: "Mededeling", incident: "Nieuwe melding" };
  if (body.visibility === "syndicus" || body.type === "incident") {
    await notifyBuilding(c.env, { buildingId: b.id, type: body.type, title: `${labels[body.type]}: ${body.title}`, body: `${user.name}: ${body.body.slice(0, 160)}`, link, roles: ["syndicus"], excludeUserId: user.id });
  }
  if (body.visibility === "all" && (body.type === "announcement" || body.priority === "urgent")) {
    await notifyBuilding(c.env, { buildingId: b.id, type: body.type, title: `${labels[body.type]}: ${body.title}`, body: body.body.slice(0, 200), link, excludeUserId: user.id });
  } else if (body.visibility === "all" && body.type === "question") {
    // vragen: in-app + push, geen e-mailstorm
    await notifyBuilding(c.env, { buildingId: b.id, type: body.type, title: `${labels[body.type]}: ${body.title}`, body: `${user.name} stelde een vraag.`, link, excludeUserId: user.id, email: false });
  }
  return c.json({ id }, 201);
});

posts.get("/:buildingId/posts/:postId", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const post = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, bm.role AS author_role, s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone, au.name AS assignee_name FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN building_members bm ON bm.user_id = p.author_id AND bm.building_id = p.building_id LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users au ON au.id = p.assignee_id
     WHERE p.id = ? AND p.building_id = ? AND ${postVisibility(b.role, user.id)}`
  ).bind(c.req.param("postId"), b.id).first<any>();
  if (!post) throw new HttpError(404, "Bericht niet gevonden");
  const ledger = post.supplier_name && isBoard(b.role) ? (await c.env.DB.prepare("SELECT je.id, je.date, je.description, (SELECT SUM(debit) FROM journal_lines x JOIN accounts a ON a.id = x.account_id WHERE x.entry_id = je.id AND a.class = 6) AS amount FROM journal_entries je WHERE je.building_id = ? AND je.counterparty = ? AND je.status = 'posted' AND je.date >= ? ORDER BY je.date DESC LIMIT 10").bind(b.id, post.supplier_name, post.created_at.slice(0, 10)).all()).results : [];
  const comments = await c.env.DB.prepare(
    "SELECT c.*, u.name AS author_name, bm.role AS author_role FROM comments c JOIN users u ON u.id = c.author_id LEFT JOIN building_members bm ON bm.user_id = c.author_id AND bm.building_id = ? WHERE c.post_id = ? ORDER BY c.created_at"
  ).bind(b.id, c.req.param("postId")).all();
  const attachments = await c.env.DB.prepare("SELECT d.id, d.name, d.size, d.mime FROM post_attachments pa JOIN documents d ON d.id = pa.document_id WHERE pa.post_id = ?").bind(c.req.param("postId")).all();
  return c.json({ post, comments: comments.results, attachments: attachments.results, ledger });
});

posts.patch("/:buildingId/posts/:postId", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const post = await c.env.DB.prepare("SELECT author_id, title FROM posts WHERE id = ? AND building_id = ?").bind(c.req.param("postId"), b.id).first<any>();
  if (!post) throw new HttpError(404, "Bericht niet gevonden");
  const body = z.object({ title: z.string().min(3).max(200).optional(), body: z.string().min(1).max(20000).optional(), status: z.enum(["open", "answered", "in_progress", "resolved", "closed"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), pinned: z.boolean().optional(),
    supplier_id: z.string().nullable().optional(), assignee_id: z.string().nullable().optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), cost_estimate: z.number().min(0).nullable().optional(), location: z.string().max(120).nullable().optional() }).parse(await c.req.json());
  const isAuthor = post.author_id === user.id;
  if (!isAuthor && !isBoard(b.role)) throw new HttpError(403, "Geen rechten");
  if (body.pinned !== undefined && !isManager(b.role)) delete body.pinned;
  if (!isBoard(b.role)) { delete body.supplier_id; delete body.assignee_id; delete body.due_date; delete body.cost_estimate; }
  if (body.status === "resolved") (body as any).resolved_at = new Date().toISOString();
  const fields = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v]);
  if (fields.length) {
    await c.env.DB.prepare(`UPDATE posts SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...fields.map(([, v]) => v), now(), c.req.param("postId")).run();
    if (body.status && !isAuthor) {
      await notifyBuilding(c.env, { buildingId: b.id, type: "post_status", title: `Status gewijzigd: ${post.title}`, body: `Nieuwe status: ${body.status}`, link: `/b/${b.id}/posts/${c.req.param("postId")}`, userIds: [post.author_id], email: false });
    }
  }
  return c.json({ ok: true });
});

posts.delete("/:buildingId/posts/:postId", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const post = await c.env.DB.prepare("SELECT author_id FROM posts WHERE id = ? AND building_id = ?").bind(c.req.param("postId"), b.id).first<any>();
  if (!post) throw new HttpError(404, "Bericht niet gevonden");
  if (post.author_id !== user.id && !isManager(b.role)) throw new HttpError(403, "Geen rechten");
  await c.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(c.req.param("postId")).run();
  return c.json({ ok: true });
});

/** Inhoud melden (notice-and-takedown): de syndicus als beheerder beoordeelt; gelogd. */
posts.post("/:buildingId/posts/:postId/report", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { reason } = z.object({ reason: z.string().min(3).max(1000) }).parse(await c.req.json());
  const post = await c.env.DB.prepare("SELECT id, title FROM posts WHERE id = ? AND building_id = ?").bind(c.req.param("postId"), b.id).first<any>();
  if (!post) throw new HttpError(404, "Bericht niet gevonden");
  await audit(c.env, b.id, user.id, "post.report", "post", post.id, { reason });
  await notifyBuilding(c.env, { buildingId: b.id, type: "report", title: `Bericht gemeld: ${post.title}`, body: `${user.name} meldt dit bericht als ongepast of onjuist. Reden: ${reason}. Beoordeel en verwijder het indien nodig.`, link: `/b/${b.id}/posts/${post.id}`, roles: ["syndicus"] });
  return c.json({ ok: true });
});

posts.post("/:buildingId/posts/:postId/comments", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const post = await c.env.DB.prepare(`SELECT p.* FROM posts p WHERE p.id = ? AND p.building_id = ? AND ${postVisibility(b.role, user.id)}`).bind(c.req.param("postId"), b.id).first<any>();
  if (!post) throw new HttpError(404, "Bericht niet gevonden");
  if (post.status === "closed") throw new HttpError(400, "Dit bericht is gesloten");
  const { body, is_answer } = z.object({ body: z.string().min(1).max(10000), is_answer: z.boolean().default(false) }).parse(await c.req.json());
  const id = uid();
  const markAnswer = is_answer && isBoard(b.role);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO comments (id, post_id, author_id, body, is_answer) VALUES (?,?,?,?,?)").bind(id, post.id, user.id, body, +markAnswer),
    c.env.DB.prepare(`UPDATE posts SET updated_at = ?${markAnswer && post.status === "open" ? ", status = 'answered'" : ""} WHERE id = ?`).bind(now(), post.id),
  ]);
  // verwittig auteur + eerdere deelnemers
  const participants = await c.env.DB.prepare("SELECT DISTINCT author_id FROM comments WHERE post_id = ? UNION SELECT author_id FROM posts WHERE id = ?").bind(post.id, post.id).all<{ author_id: string }>();
  const userIds = participants.results.map((p) => p.author_id).filter((u) => u !== user.id);
  if (post.visibility === "syndicus") {
    const syndici = await c.env.DB.prepare("SELECT user_id FROM building_members WHERE building_id = ? AND role = 'syndicus'").bind(b.id).all<{ user_id: string }>();
    for (const s of syndici.results) if (!userIds.includes(s.user_id) && s.user_id !== user.id) userIds.push(s.user_id);
  }
  await notifyBuilding(c.env, { buildingId: b.id, type: "comment", title: `${markAnswer ? "Antwoord" : "Reactie"} op: ${post.title}`, body: `${user.name}: ${body.slice(0, 160)}`, link: `/b/${b.id}/posts/${post.id}`, userIds, email: markAnswer });
  return c.json({ id }, 201);
});

/** Bijlage (foto, bestek) koppelen aan een bericht; het document zelf wordt via Documenten geüpload. */
posts.post("/:buildingId/posts/:postId/attachments", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const post = await c.env.DB.prepare("SELECT author_id FROM posts WHERE id = ? AND building_id = ?").bind(c.req.param("postId"), b.id).first<any>();
  if (!post) throw new HttpError(404, "Bericht niet gevonden");
  if (post.author_id !== user.id && !isBoard(b.role)) throw new HttpError(403, "Geen rechten");
  const { document_id } = z.object({ document_id: z.string() }).parse(await c.req.json());
  await c.env.DB.prepare("INSERT OR IGNORE INTO post_attachments (post_id, document_id) VALUES (?, ?)").bind(c.req.param("postId"), document_id).run();
  return c.json({ ok: true });
});

posts.delete("/:buildingId/posts/:postId/comments/:commentId", requireBuilding(), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const cm = await c.env.DB.prepare("SELECT author_id FROM comments WHERE id = ? AND post_id = ?").bind(c.req.param("commentId"), c.req.param("postId")).first<any>();
  if (!cm) throw new HttpError(404, "Reactie niet gevonden");
  if (cm.author_id !== user.id && !isManager(b.role)) throw new HttpError(403, "Geen rechten");
  await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(c.req.param("commentId")).run();
  return c.json({ ok: true });
});

export default posts;
