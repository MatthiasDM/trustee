import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, isManager, isOwner, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, safeFilename, uid, now } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { safeContentType, validateUpload } from "../lib/files";
import { assertDemoUpload } from "../lib/publicdemo";

const docs = new Hono<AppEnv>();
docs.use("*", requireAuth);


/** SQL-filter op zichtbaarheid volgens rol. */
export function documentVisibility(role: string, userId?: string, alias = "", opts: { includeDeleted?: boolean } = {}): string {
  const a = alias ? `${alias}.` : "";
  const live = opts.includeDeleted ? "1=1" : `${a}deleted_at IS NULL`; // prullenbak: zacht verwijderde stukken zijn onzichtbaar
  // Raad en commissaris hebben wettelijk inzagerecht in alle beheersdocumenten (art. 3.90 en 3.91 BW)
  if (isManager(role) || isBoard(role)) return live;
  // documenten van één kavel (afrekening, herinnering) enkel voor de eigenaars van die kavel
  const unitScope = userId ? `(${a}unit_id IS NULL OR ${a}unit_id IN (SELECT uo.unit_id FROM unit_owners uo WHERE uo.user_id = '${userId.replace(/'/g, "")}'))` : `${a}unit_id IS NULL`;
  if (isOwner(role)) return `(${live} AND ${a}visibility IN ('all','owners_only') AND ${unitScope})`;
  return `(${live} AND ${a}visibility = 'all' AND ${a}unit_id IS NULL)`;
}

docs.get("/:buildingId/folders", requireBuilding(), async (c) => {
  const b = c.get("building");
  const folderVis = isBoard(b.role) ? "1=1" : "visibility = 'all'";
  const rows = await c.env.DB.prepare(`SELECT id, parent_id, name, visibility FROM folders WHERE building_id = ? AND ${folderVis} ORDER BY name`).bind(b.id).all();
  return c.json(rows.results);
});

docs.post("/:buildingId/folders", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const body = z.object({ name: z.string().min(1).max(120), parent_id: z.string().nullable().optional(), visibility: z.enum(["all", "raad", "syndicus"]).default("all") }).parse(await c.req.json());
  const id = uid();
  await c.env.DB.prepare("INSERT INTO folders (id, building_id, parent_id, name, visibility) VALUES (?,?,?,?,?)").bind(id, b.id, body.parent_id ?? null, body.name, body.visibility).run();
  return c.json({ id }, 201);
});

docs.patch("/:buildingId/folders/:folderId", requireBuilding("syndicus", "raad"), async (c) => {
  const body = z.object({ name: z.string().min(1).max(120).optional(), parent_id: z.string().nullable().optional(), visibility: z.enum(["all", "raad", "syndicus"]).optional() }).parse(await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE folders SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("folderId"), c.get("building").id).run();
  return c.json({ ok: true });
});

docs.delete("/:buildingId/folders/:folderId", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE folder_id = ?").bind(c.req.param("folderId")).first<{ n: number }>();
  if (count && count.n > 0) throw new HttpError(400, "Map is niet leeg");
  await c.env.DB.prepare("DELETE FROM folders WHERE id = ? AND building_id = ?").bind(c.req.param("folderId"), b.id).run();
  return c.json({ ok: true });
});

docs.get("/:buildingId/documents", requireBuilding(), async (c) => {
  const b = c.get("building");
  const folder = c.req.query("folder"); // 'root' | id | undefined (alles)
  const q = c.req.query("q");
  const category = c.req.query("category");
  const conds = [`d.building_id = ?`, documentVisibility(b.role, c.get("user").id, "d")];
  const params: unknown[] = [b.id];
  if (folder === "root") conds.push("d.folder_id IS NULL");
  else if (folder) { conds.push("d.folder_id = ?"); params.push(folder); }
  if (q) { conds.push("(d.name LIKE ? OR d.description LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (category) { conds.push("d.category = ?"); params.push(category); }
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.folder_id, d.name, d.description, d.category, d.size, d.mime, d.visibility, d.version, d.created_at, d.unit_id, un.label AS unit_label, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN units un ON un.id = d.unit_id LEFT JOIN users u ON u.id = d.uploaded_by WHERE ${conds.join(" AND ")} ORDER BY d.created_at DESC LIMIT 500`
  ).bind(...params).all();
  return c.json(rows.results);
});

/** Upload via multipart/form-data: file, folder_id?, category?, visibility?, description?, notify? */
docs.post("/:buildingId/documents", requireBuilding("syndicus", "raad", "eigenaar", "commissaris"), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Geen bestand");
  validateUpload(file);
  await assertDemoUpload(c.env, b.id, file);
  const meta = z.object({
    folder_id: z.string().nullable().optional(),
    category: z.string().max(40).default("overig"),
    visibility: z.enum(["all", "raad", "syndicus", "owners_only"]).default("all"),
    description: z.string().max(1000).nullable().optional(), // leeg veld komt als null binnen
    notify: z.coerce.boolean().default(false),
  }).parse(Object.fromEntries([...form.entries()].filter(([k]) => k !== "file").map(([k, v]) => [k, v === "null" || v === "" ? null : v])));
  // eigenaars mogen enkel in 'all' uploaden en niet notifiëren
  if (!isBoard(b.role)) { meta.visibility = "all"; meta.notify = false; }
  const id = uid();
  const key = `${b.id}/${id}/${safeFilename(file.name)}`;
  await c.env.DOCS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { building: b.id, uploadedBy: user.id } });
  await c.env.DB.prepare("INSERT INTO documents (id, building_id, folder_id, name, description, category, r2_key, size, mime, visibility, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, meta.folder_id ?? null, file.name, meta.description ?? null, meta.category, key, file.size, file.type || "application/octet-stream", meta.visibility, user.id).run();
  await audit(c.env, b.id, user.id, "document.upload", "document", id, { name: file.name });
  if (meta.notify) {
    const roles = meta.visibility === "syndicus" ? ["syndicus"] : meta.visibility === "raad" ? ["syndicus", "raad", "commissaris"] : meta.visibility === "owners_only" ? ["syndicus", "raad", "eigenaar", "commissaris"] : undefined;
    await notifyBuilding(c.env, { buildingId: b.id, type: "document", title: `Nieuw document: ${file.name}`, body: meta.description ?? `${user.name} plaatste een nieuw document in ${b.name}.`, link: `/b/${b.id}/documents${meta.folder_id ? `?folder=${meta.folder_id}` : ""}`, roles, excludeUserId: user.id });
  }
  return c.json({ id }, 201);
});

async function loadDoc(c: any) {
  const b = c.get("building");
  const d = await c.env.DB.prepare(`SELECT * FROM documents d WHERE d.id = ? AND d.building_id = ? AND ${documentVisibility(b.role, c.get("user").id, "d")}`).bind(c.req.param("docId"), b.id).first();
  if (!d) throw new HttpError(404, "Document niet gevonden");
  return d as any;
}

/**
 * Wettelijke kennisgeving (art. 3.90 BW): de raad van mede-eigendom neemt inzage in beheersdocumenten
 * "na de syndicus op de hoogte te hebben gebracht". Opent een raadslid (of de commissaris) een stuk dat enkel
 * voor de syndicus zichtbaar is, dan wordt de syndicus automatisch verwittigd en wordt de inzage gelogd.
 * Het inzagerecht zelf wordt nooit geblokkeerd. Eén melding per document per persoon per dag.
 */
async function notifyInspection(c: any, d: any) {
  const b = c.get("building"); const user = c.get("user");
  if (d.visibility !== "syndicus" || !(b.role === "raad" || b.role === "commissaris")) return;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const recent = await c.env.DB.prepare("SELECT 1 FROM audit_log WHERE building_id = ? AND user_id = ? AND action = 'document.inspect' AND target_id = ? AND created_at > ? LIMIT 1").bind(b.id, user.id, d.id, since).first();
  if (recent) return;
  await audit(c.env, b.id, user.id, "document.inspect", "document", d.id, { name: d.name, role: b.role });
  const label = b.role === "raad" ? "Raad van mede-eigendom" : "Commissaris van de rekeningen";
  await notifyBuilding(c.env, { buildingId: b.id, type: "inspection", title: `Kennisgeving inzage: ${d.name}`, body: `${user.name} (${label}) nam inzage in dit document (art. 3.90 BW).`, link: `/b/${b.id}/documents${d.folder_id ? `?folder=${d.folder_id}` : ""}`, roles: ["syndicus"], excludeUserId: user.id, email: false });
}

docs.get("/:buildingId/documents/:docId/download", requireBuilding(), async (c) => {
  const d = await loadDoc(c);
  await notifyInspection(c, d);
  // ontvangst van de notulen bijhouden (art. 3.87 §12): eerste keer openen
  if (d.category === "verslag_av") await c.env.DB.prepare("UPDATE minutes_receipts SET opened_at = COALESCE(opened_at, ?) WHERE user_id = ? AND meeting_id IN (SELECT id FROM meetings WHERE minutes_document_id = ?)").bind(now(), c.get("user").id, d.id).run();
  const obj = await c.env.DOCS.get(d.r2_key);
  if (!obj) throw new HttpError(404, "Bestand niet gevonden in opslag");
  const ct = safeContentType(d.mime, d.name);
  const inline = c.req.query("inline") === "1" && /^(application\/pdf|image\/|text\/plain|text\/html)/.test(ct);
  const headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set("etag", obj.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  headers.set("Cache-Control", "private, max-age=0");
  return new Response(obj.body, { headers });
});

docs.patch("/:buildingId/documents/:docId", requireBuilding("syndicus", "raad"), async (c) => {
  const body = z.object({ name: z.string().min(1).max(200).optional(), description: z.string().max(1000).nullable().optional(), category: z.string().max(40).optional(), folder_id: z.string().nullable().optional(), visibility: z.enum(["all", "raad", "syndicus", "owners_only"]).optional() }).parse(await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE documents SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("docId"), c.get("building").id).run();
  return c.json({ ok: true });
});

/** Nieuwe versie uploaden (vervangt bestand, verhoogt versienummer). */
docs.post("/:buildingId/documents/:docId/version", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const d = await loadDoc(c);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Geen bestand");
  validateUpload(file);
  await assertDemoUpload(c.env, b.id, file, d.size || 1);
  const key = `${b.id}/${d.id}/v${d.version + 1}/${safeFilename(file.name)}`;
  await c.env.DOCS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  await c.env.DB.prepare("UPDATE documents SET r2_key = ?, size = ?, mime = ?, version = version + 1, name = ? WHERE id = ?").bind(key, file.size, file.type || "application/octet-stream", file.name, d.id).run();
  await audit(c.env, b.id, c.get("user").id, "document.version", "document", d.id);
  return c.json({ ok: true, version: d.version + 1 });
});

docs.delete("/:buildingId/documents/:docId", requireBuilding("syndicus", "raad", "eigenaar"), async (c) => {
  const b = c.get("building");
  const user = c.get("user");
  const d = await loadDoc(c);
  if (!isBoard(b.role) && d.uploaded_by !== user.id) throw new HttpError(403, "Enkel eigen documenten verwijderen");
  // Zacht verwijderen: 30 dagen herstelbaar via de prullenbak; het bestand blijft zolang in de opslag.
  await c.env.DB.prepare("UPDATE documents SET deleted_at = ?, deleted_by = ? WHERE id = ?").bind(now(), user.id, d.id).run();
  await audit(c.env, b.id, user.id, "document.delete", "document", d.id, { name: d.name });
  return c.json({ ok: true });
});

/** Prullenbak: zacht verwijderde documenten (enkel syndicus), met wie en wanneer. */
docs.get("/:buildingId/trash", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare("SELECT d.id, d.name, d.category, d.size, d.deleted_at, u.name AS deleted_by_name FROM documents d LEFT JOIN users u ON u.id = d.deleted_by WHERE d.building_id = ? AND d.deleted_at IS NOT NULL ORDER BY d.deleted_at DESC").bind(b.id).all();
  return c.json(rows.results);
});
docs.post("/:buildingId/trash/:docId/restore", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const d = await c.env.DB.prepare("SELECT id, name FROM documents WHERE id = ? AND building_id = ? AND deleted_at IS NOT NULL").bind(c.req.param("docId"), b.id).first<any>();
  if (!d) throw new HttpError(404, "Niet in de prullenbak");
  await c.env.DB.prepare("UPDATE documents SET deleted_at = NULL, deleted_by = NULL WHERE id = ?").bind(d.id).run();
  await audit(c.env, b.id, c.get("user").id, "document.restore", "document", d.id, { name: d.name });
  return c.json({ ok: true });
});

/** Cron: definitief wissen van documenten die meer dan 30 dagen in de prullenbak zitten. */
export async function purgeTrash(env: AppEnv["Bindings"]) {
  const limit = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = (await env.DB.prepare("SELECT id, r2_key FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 200").bind(limit).all<{ id: string; r2_key: string }>()).results;
  for (const d of rows) { await env.DOCS.delete(d.r2_key); await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(d.id).run(); }
  return rows.length;
}

// ---- Opmerkingen op documenten (controle door commissaris / raad; geen bewerking) ----
docs.get("/:buildingId/documents/:docId/comments", requireBuilding(), async (c) => {
  const d = await loadDoc(c);
  const rows = await c.env.DB.prepare("SELECT dc.*, u.name AS author_name, bm.role AS author_role FROM document_comments dc JOIN users u ON u.id = dc.author_id LEFT JOIN building_members bm ON bm.user_id = dc.author_id AND bm.building_id = ? WHERE dc.document_id = ? ORDER BY dc.created_at").bind(c.get("building").id, d.id).all();
  return c.json(rows.results);
});

docs.post("/:buildingId/documents/:docId/comments", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const d = await loadDoc(c);
  const { body, kind } = z.object({ body: z.string().min(1).max(5000), kind: z.enum(["remark", "finding", "approved"]).default("remark") }).parse(await c.req.json());
  const id = uid();
  await c.env.DB.prepare("INSERT INTO document_comments (id, document_id, author_id, body, kind) VALUES (?,?,?,?,?)").bind(id, d.id, user.id, body, kind).run();
  await audit(c.env, b.id, user.id, `document.comment.${kind}`, "document", d.id);
  const labels = { remark: "Opmerking", finding: "Bevinding", approved: "Goedgekeurd" };
  await notifyBuilding(c.env, { buildingId: b.id, type: "document_comment", title: `${labels[kind]} bij ${d.name}`, body: `${user.name}: ${body.slice(0, 160)}`, link: `/b/${b.id}/documents${d.folder_id ? `?folder=${d.folder_id}` : ""}`, roles: ["syndicus", "raad", "commissaris"], excludeUserId: user.id, email: kind === "finding" });
  return c.json({ id }, 201);
});

docs.delete("/:buildingId/documents/:docId/comments/:commentId", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const cm = await c.env.DB.prepare("SELECT author_id FROM document_comments WHERE id = ? AND document_id = ?").bind(c.req.param("commentId"), c.req.param("docId")).first<any>();
  if (!cm) throw new HttpError(404, "Opmerking niet gevonden");
  if (cm.author_id !== user.id && !isManager(b.role)) throw new HttpError(403, "Geen rechten");
  await c.env.DB.prepare("DELETE FROM document_comments WHERE id = ?").bind(c.req.param("commentId")).run();
  return c.json({ ok: true });
});

export default docs;
