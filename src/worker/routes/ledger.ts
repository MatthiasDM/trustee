import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, isManager, requireAuth, requireBuilding } from "../lib/auth";
import { reserveCheck } from "../lib/reserve";
import { HttpError, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { TEMPLATES, allocate, ensureChart, fiscalYearFor, keyWeights, ogm, ogmDigits, parseBankCsv, parseCoda, postEntry, reverseEntry, round2, templateByCode, type LineInput } from "../lib/ledger";
import { classOf, normalSide } from "../lib/chart";
import { generateAnnualReport } from "../lib/reports";

const ledger = new Hono<AppEnv>();
ledger.use("*", requireAuth);
ledger.use("/:buildingId/*", requireBuilding(), async (c, next) => { await ensureChart(c.env, c.get("building").id); await next(); });
const mgr = requireBuilding("syndicus");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- Boekjaren ----------
/** Controle verplicht reservekapitaal en aparte rekeningen (art. 3.86 §3 BW). */
ledger.get("/:buildingId/ledger/reserve-check", async (c) => c.json(await reserveCheck(c.env, c.get("building").id, c.req.query("fy"))));
ledger.get("/:buildingId/ledger/fiscal-years", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM fiscal_years WHERE building_id = ? ORDER BY start_date DESC").bind(c.get("building").id).all()).results));
ledger.post("/:buildingId/ledger/fiscal-years", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ label: z.string().min(2).max(20), start_date: ymd, end_date: ymd }).parse(await c.req.json());
  if (body.end_date <= body.start_date) throw new HttpError(400, "Einddatum moet na startdatum liggen");
  const overlap = await c.env.DB.prepare("SELECT 1 FROM fiscal_years WHERE building_id = ? AND start_date <= ? AND end_date >= ?").bind(b.id, body.end_date, body.start_date).first();
  if (overlap) throw new HttpError(400, "Overlapt met een bestaand boekjaar");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO fiscal_years (id, building_id, label, start_date, end_date) VALUES (?,?,?,?,?)").bind(id, b.id, body.label, body.start_date, body.end_date).run();
  // ontbrekende afschrijvingen voor dit boekjaar aanmaken
  const assets = (await c.env.DB.prepare("SELECT * FROM fixed_assets WHERE building_id = ?").bind(b.id).all()).results as any[];
  let scheduled = 0; for (const a of assets) scheduled += await scheduleDepreciation(c.env, b.id, c.get("user").id, a);
  return c.json({ id, scheduled }, 201);
});
/** Afsluiting: resultaat per fonds overdragen (693 → 48901/48902), boekjaar sluiten. */
ledger.post("/:buildingId/ledger/fiscal-years/:fyId/close", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const fy = await c.env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(c.req.param("fyId"), b.id).first<any>();
  if (!fy) throw new HttpError(404, "Boekjaar niet gevonden");
  if (fy.status === "closed") throw new HttpError(400, "Al afgesloten");
  const { approved_meeting_id } = z.object({ approved_meeting_id: z.string().nullable().optional() }).parse(await c.req.json().catch(() => ({})));
  const scheduled = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE fiscal_year_id = ? AND status = 'scheduled'").bind(fy.id).first<{ n: number }>();
  if (scheduled && scheduled.n > 0) throw new HttpError(400, `Er staan nog ${scheduled.n} geplande boekingen (afschrijvingen) in dit boekjaar`);
  // resultaat = opbrengsten - kosten, per fonds (reserve: 700/751, kosten gemarkeerd 'reservekapitaal'; de rest werkkapitaal)
  const rows = (await c.env.DB.prepare(
    `SELECT a.code, a.type, a.fund, jl.memo, SUM(jl.credit - jl.debit) AS bal FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
     WHERE je.fiscal_year_id = ? AND je.status = 'posted' AND a.class IN (6,7) AND a.code NOT IN ('693','793') GROUP BY a.code, a.type, a.fund, jl.memo`).bind(fy.id).all()).results as any[];
  let reserve = 0, working = 0;
  for (const r of rows) { if (r.fund === "reserve" || (r.type === "expense" && r.memo === "reservekapitaal")) reserve += r.bal; else working += r.bal; }
  reserve = round2(reserve); working = round2(working);
  const lines: LineInput[] = [];
  const total = round2(reserve + working);
  if (total > 0) lines.push({ account_code: "693", debit: total });
  if (total < 0) lines.push({ account_code: "793", credit: -total });
  if (reserve !== 0) lines.push(reserve > 0 ? { account_code: "48901", credit: reserve } : { account_code: "48901", debit: -reserve });
  if (working !== 0) lines.push(working > 0 ? { account_code: "48902", credit: working } : { account_code: "48902", debit: -working });
  let entryId: string | null = null;
  if (lines.length >= 2) entryId = await postEntry(c.env, b.id, user.id, { date: fy.end_date, description: `Afsluiting boekjaar ${fy.label}: overdracht resultaat`, source: "closing", lines });
  await c.env.DB.prepare("UPDATE fiscal_years SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), approved_meeting_id = ? WHERE id = ?").bind(approved_meeting_id ?? null, fy.id).run();
  await audit(c.env, b.id, user.id, "ledger.close_year", "fiscal_year", fy.id, { reserve, working });
  const reportDocId = await generateAnnualReport(c.env, b.id, user.id, fy.id, false);
  return c.json({ ok: true, entryId, reserve, working, reportDocId });
});

// ---------- Rekeningen ----------
ledger.get("/:buildingId/ledger/accounts", async (c) => {
  const b = c.get("building");
  const fy = c.req.query("fy");
  const rows = (await c.env.DB.prepare(
    `SELECT a.*, COALESCE(SUM(CASE WHEN je.status='posted' ${fy ? "AND je.fiscal_year_id = ?2" : ""} THEN jl.debit END),0) AS debit, COALESCE(SUM(CASE WHEN je.status='posted' ${fy ? "AND je.fiscal_year_id = ?2" : ""} THEN jl.credit END),0) AS credit
     FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id = a.id LEFT JOIN journal_entries je ON je.id = jl.entry_id
     WHERE a.building_id = ?1 GROUP BY a.id ORDER BY a.code`).bind(...(fy ? [b.id, fy] : [b.id])).all()).results as any[];
  return c.json(rows.map((r) => ({ ...r, balance: round2(r.normal_side === "debit" ? r.debit - r.credit : r.credit - r.debit) })));
});
ledger.post("/:buildingId/ledger/accounts", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ code: z.string().regex(/^\d{2,8}$/), name: z.string().min(2).max(120), fund: z.enum(["reserve", "working"]).nullable().optional() }).parse(await c.req.json());
  const cls = classOf(body.code);
  const type = cls === 1 ? "liability" : cls === 2 ? "asset" : cls === 4 ? (body.code.startsWith("41") || body.code.startsWith("49") ? "asset" : "liability") : cls === 5 ? "asset" : cls === 6 ? "expense" : cls === 7 ? "income" : null;
  if (!type) throw new HttpError(400, "Code moet beginnen met klasse 1, 2, 4, 5, 6 of 7");
  const id = uid();
  try { await c.env.DB.prepare("INSERT INTO accounts (id, building_id, code, name, class, type, normal_side, fund, is_header, is_system) VALUES (?,?,?,?,?,?,?,?,0,0)").bind(id, b.id, body.code, body.name, cls, type, normalSide(type), body.fund ?? null).run(); }
  catch { throw new HttpError(409, "Deze code bestaat al"); }
  return c.json({ id }, 201);
});
ledger.patch("/:buildingId/ledger/accounts/:accountId", mgr, async (c) => {
  const body = z.object({ name: z.string().min(2).max(120).optional(), active: z.boolean().optional(), fund: z.enum(["reserve", "working"]).nullable().optional() }).parse(await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v]);
  if (fields.length) await c.env.DB.prepare(`UPDATE accounts SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("accountId"), c.get("building").id).run();
  return c.json({ ok: true });
});

// ---------- Verdeelsleutels ----------
ledger.get("/:buildingId/ledger/cost-keys", async (c) => {
  const b = c.get("building");
  const keys = (await c.env.DB.prepare("SELECT * FROM cost_keys WHERE building_id = ? ORDER BY is_default DESC, name").bind(b.id).all()).results as any[];
  const w = (await c.env.DB.prepare("SELECT cku.* FROM cost_key_units cku JOIN cost_keys k ON k.id = cku.cost_key_id WHERE k.building_id = ?").bind(b.id).all()).results as any[];
  for (const k of keys) k.weights = w.filter((x) => x.cost_key_id === k.id);
  return c.json(keys);
});
ledger.post("/:buildingId/ledger/cost-keys", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ name: z.string().min(2).max(80), basis: z.enum(["shares", "equal", "custom"]), weights: z.array(z.object({ unit_id: z.string(), weight: z.number().min(0) })).optional() }).parse(await c.req.json());
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO cost_keys (id, building_id, name, basis) VALUES (?,?,?,?)").bind(id, b.id, body.name, body.basis),
    ...(body.weights ?? []).map((w) => c.env.DB.prepare("INSERT INTO cost_key_units (cost_key_id, unit_id, weight) VALUES (?,?,?)").bind(id, w.unit_id, w.weight)),
  ]);
  return c.json({ id }, 201);
});
ledger.put("/:buildingId/ledger/cost-keys/:keyId", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ name: z.string().min(2).max(80).optional(), weights: z.array(z.object({ unit_id: z.string(), weight: z.number().min(0) })).optional() }).parse(await c.req.json());
  const key = await c.env.DB.prepare("SELECT * FROM cost_keys WHERE id = ? AND building_id = ?").bind(c.req.param("keyId"), b.id).first<any>();
  if (!key) throw new HttpError(404, "Sleutel niet gevonden");
  const stmts = [];
  if (body.name) stmts.push(c.env.DB.prepare("UPDATE cost_keys SET name = ? WHERE id = ?").bind(body.name, key.id));
  if (body.weights) { stmts.push(c.env.DB.prepare("DELETE FROM cost_key_units WHERE cost_key_id = ?").bind(key.id)); for (const w of body.weights) stmts.push(c.env.DB.prepare("INSERT INTO cost_key_units (cost_key_id, unit_id, weight) VALUES (?,?,?)").bind(key.id, w.unit_id, w.weight)); }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
ledger.delete("/:buildingId/ledger/cost-keys/:keyId", mgr, async (c) => {
  const k = await c.env.DB.prepare("SELECT is_default FROM cost_keys WHERE id = ? AND building_id = ?").bind(c.req.param("keyId"), c.get("building").id).first<any>();
  if (!k) throw new HttpError(404, "Sleutel niet gevonden");
  if (k.is_default) throw new HttpError(400, "De standaardsleutel kan niet verwijderd worden");
  await c.env.DB.prepare("DELETE FROM cost_keys WHERE id = ?").bind(c.req.param("keyId")).run();
  return c.json({ ok: true });
});

// ---------- Dagboek ----------
ledger.get("/:buildingId/ledger/entries", async (c) => {
  const b = c.get("building");
  const q = c.req.query();
  const conds = ["je.building_id = ?"]; const params: unknown[] = [b.id];
  if (q.fy) { conds.push("je.fiscal_year_id = ?"); params.push(q.fy); }
  if (q.status) { conds.push("je.status = ?"); params.push(q.status); }
  if (q.account) { conds.push("EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = je.id AND x.account_id = ?)"); params.push(q.account); }
  if (q.q) { conds.push("(je.description LIKE ? OR je.counterparty LIKE ?)"); params.push(`%${q.q}%`, `%${q.q}%`); }
  const entries = (await c.env.DB.prepare(`SELECT je.*, u.name AS created_by_name, d.name AS document_name, (SELECT COUNT(*) FROM ledger_comments lc WHERE lc.entry_id = je.id) AS comment_count FROM journal_entries je LEFT JOIN users u ON u.id = je.created_by LEFT JOIN documents d ON d.id = je.document_id WHERE ${conds.join(" AND ")} ORDER BY je.date DESC, je.number DESC LIMIT 500`).bind(...params).all()).results as any[];
  if (!entries.length) return c.json([]);
  const ids = entries.map((e) => e.id);
  const lines = (await c.env.DB.prepare(`SELECT jl.*, a.code, a.name AS account_name, un.label AS unit_label FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id LEFT JOIN units un ON un.id = jl.unit_id WHERE jl.entry_id IN (${ids.map(() => "?").join(",")}) ORDER BY jl.position`).bind(...ids).all()).results as any[];
  for (const e of entries) { e.lines = lines.filter((l) => l.entry_id === e.id); e.total = round2(e.lines.reduce((s: number, l: any) => s + l.debit, 0)); }
  return c.json(entries);
});
const lineSchema = z.object({ account_code: z.string().optional(), account_id: z.string().optional(), debit: z.number().min(0).default(0), credit: z.number().min(0).default(0), unit_id: z.string().nullable().optional(), cost_key_id: z.string().nullable().optional(), memo: z.string().max(200).nullable().optional() });
ledger.post("/:buildingId/ledger/entries", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({ date: ymd, description: z.string().min(2).max(300), counterparty: z.string().max(160).nullable().optional(), document_id: z.string().nullable().optional(), lines: z.array(lineSchema).min(2) }).parse(await c.req.json());
  const id = await postEntry(c.env, b.id, user.id, { ...body, source: "manual" });
  await audit(c.env, b.id, user.id, "ledger.post", "entry", id, { description: body.description });
  return c.json({ id }, 201);
});
ledger.post("/:buildingId/ledger/entries/:entryId/reverse", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { date, reason } = z.object({ date: ymd, reason: z.string().min(2).max(200) }).parse(await c.req.json());
  const id = await reverseEntry(c.env, b.id, user.id, c.req.param("entryId"), date, reason);
  await audit(c.env, b.id, user.id, "ledger.reverse", "entry", c.req.param("entryId"), { reason });
  return c.json({ id }, 201);
});
ledger.get("/:buildingId/ledger/entries/:entryId/comments", async (c) => c.json((await c.env.DB.prepare("SELECT lc.*, u.name AS author_name, bm.role AS author_role FROM ledger_comments lc JOIN users u ON u.id = lc.author_id LEFT JOIN building_members bm ON bm.user_id = lc.author_id AND bm.building_id = lc.building_id WHERE lc.entry_id = ? AND lc.building_id = ? ORDER BY lc.created_at").bind(c.req.param("entryId"), c.get("building").id).all()).results));
ledger.post("/:buildingId/ledger/entries/:entryId/comments", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { body, kind } = z.object({ body: z.string().min(1).max(3000), kind: z.enum(["remark", "finding", "approved"]).default("remark") }).parse(await c.req.json());
  const e = await c.env.DB.prepare("SELECT number, description FROM journal_entries WHERE id = ? AND building_id = ?").bind(c.req.param("entryId"), b.id).first<any>();
  if (!e) throw new HttpError(404, "Boeking niet gevonden");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO ledger_comments (id, building_id, entry_id, author_id, body, kind) VALUES (?,?,?,?,?,?)").bind(id, b.id, e ? c.req.param("entryId") : "", user.id, body, kind).run();
  await audit(c.env, b.id, user.id, `ledger.comment.${kind}`, "entry", c.req.param("entryId"));
  if (kind === "finding") await notifyBuilding(c.env, { buildingId: b.id, type: "ledger_finding", title: `Bevinding bij boeking #${e.number}`, body: `${user.name}: ${body.slice(0, 160)}`, link: `/b/${b.id}/ledger?tab=journal`, roles: ["syndicus", "raad", "commissaris"], excludeUserId: user.id });
  return c.json({ id }, 201);
});

// ---------- Handelingen ----------
ledger.get("/:buildingId/ledger/templates", async (c) => c.json(TEMPLATES.map(({ build: _b, ...t }) => t)));
ledger.post("/:buildingId/ledger/templates/:code/post", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const t = templateByCode(c.req.param("code"));
  if (!t) throw new HttpError(404, "Onbekende handeling");
  const v = await c.req.json() as Record<string, any>;
  for (const f of t.fields) if (f.required && (v[f.key] === undefined || v[f.key] === "" || v[f.key] === null)) throw new HttpError(400, `Veld "${f.label}" is verplicht`);
  if (v.amount !== undefined && !(+v.amount > 0)) throw new HttpError(400, "Bedrag moet groter zijn dan 0");
  const bankRow = async (id: string) => { const r = await c.env.DB.prepare("SELECT ba.fund, a.code FROM bank_accounts ba JOIN accounts a ON a.id = ba.account_id WHERE ba.id = ? AND ba.building_id = ?").bind(id, b.id).first<any>(); if (!r) throw new HttpError(400, "Bankrekening niet gevonden"); return r; };
  const built = await t.build(v, { bankCodeFor: async (id) => (await bankRow(id)).code, fundOf: async (id) => (await bankRow(id)).fund });
  const id = await postEntry(c.env, b.id, user.id, { date: v.date, description: built.description, counterparty: built.counterparty ?? null, document_id: v.document_id || null, template_code: t.code, source: "template", lines: built.lines });
  await audit(c.env, b.id, user.id, "ledger.post", "entry", id, { template: t.code });
  return c.json({ id }, 201);
});

// ---------- Vaste activa en afschrijvingen ----------
ledger.get("/:buildingId/ledger/assets", async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT fa.*, aa.code AS asset_code, (SELECT COALESCE(SUM(jl.credit - jl.debit),0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.account_id = fa.depreciation_account_id AND je.status = 'posted' AND je.description LIKE '%' || fa.name || '%') AS depreciated,
     (SELECT COUNT(*) FROM journal_entries je WHERE je.source = 'depreciation' AND je.status = 'scheduled' AND je.description LIKE '%' || fa.name || '%' AND je.building_id = fa.building_id) AS scheduled_count
     FROM fixed_assets fa JOIN accounts aa ON aa.id = fa.asset_account_id WHERE fa.building_id = ? ORDER BY fa.acquired_at DESC`).bind(c.get("building").id).all()).results as any[];
  return c.json(rows.map((r) => ({ ...r, book_value: round2(r.cost - r.depreciated) })));
});
/** Registreert een actief en plant alle afschrijvingen; verleden periodes worden meteen geboekt, toekomstige staan 'scheduled'. */
ledger.post("/:buildingId/ledger/assets", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({ name: z.string().min(2).max(120), asset_code: z.string().default("2300"), cost: z.number().positive(), acquired_at: ymd, years: z.number().int().min(1).max(50), frequency: z.enum(["yearly", "monthly"]).default("yearly"), purchase_entry_id: z.string().nullable().optional() }).parse(await c.req.json());
  const assetAcc = await c.env.DB.prepare("SELECT * FROM accounts WHERE building_id = ? AND code = ?").bind(b.id, body.asset_code).first<any>();
  const deprCode = body.asset_code.slice(0, -1) + "9";
  const deprAcc = await c.env.DB.prepare("SELECT * FROM accounts WHERE building_id = ? AND code = ?").bind(b.id, deprCode).first<any>();
  const expAcc = await c.env.DB.prepare("SELECT * FROM accounts WHERE building_id = ? AND code = ?").bind(b.id, body.asset_code.startsWith("21") ? "6301" : "6302").first<any>();
  if (!assetAcc || !deprAcc || !expAcc) throw new HttpError(400, `Activarekening ${body.asset_code} heeft geen bijhorende afschrijvingsrekening ${deprCode}`);
  const id = uid();
  await c.env.DB.prepare("INSERT INTO fixed_assets (id, building_id, name, asset_account_id, depreciation_account_id, expense_account_id, cost, acquired_at, years, frequency, purchase_entry_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, body.name, assetAcc.id, deprAcc.id, expAcc.id, body.cost, body.acquired_at, body.years, body.frequency, body.purchase_entry_id ?? null).run();
  const asset = await c.env.DB.prepare("SELECT * FROM fixed_assets WHERE id = ?").bind(id).first<any>();
  const created = await scheduleDepreciation(c.env, b.id, user.id, asset);
  const periods = body.frequency === "yearly" ? body.years : body.years * 12;
  await audit(c.env, b.id, user.id, "ledger.asset", "asset", id, { name: body.name, scheduled: created });
  return c.json({ id, scheduled: created, note: created < periods ? `${created} van ${periods} afschrijvingen gepland; de overige volgen automatisch zodra die boekjaren aangemaakt zijn.` : undefined }, 201);
});

/**
 * Lineair afschrijvingsplan: één boeking per periode op de laatste dag ervan. Bestaande boekingen worden overgeslagen,
 * periodes zonder boekjaar ook (ze worden aangemaakt zodra dat boekjaar geopend wordt). Verleden = posted, toekomst = scheduled.
 */
export async function scheduleDepreciation(env: AppEnv["Bindings"], buildingId: string, userId: string | null, asset: any): Promise<number> {
  const periods = asset.frequency === "yearly" ? asset.years : asset.years * 12;
  const per = round2(asset.cost / periods);
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(asset.acquired_at + "T00:00:00Z");
  const existing = new Set(((await env.DB.prepare("SELECT description FROM journal_entries WHERE building_id = ? AND source = 'depreciation' AND description LIKE ?").bind(buildingId, `Afschrijving ${asset.name} (%`).all()).results as any[]).map((r) => r.description));
  let booked = 0; let created = 0;
  for (let i = 0; i < periods; i++) {
    const d = new Date(start);
    if (asset.frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + i, 11, 31); else d.setUTCMonth(d.getUTCMonth() + i + 1, 0);
    const date = d.toISOString().slice(0, 10);
    const amt = i === periods - 1 ? round2(asset.cost - booked) : per; booked = round2(booked + amt);
    const description = `Afschrijving ${asset.name} (${i + 1}/${periods})`;
    if (existing.has(description)) continue;
    const fy = await env.DB.prepare("SELECT id, status FROM fiscal_years WHERE building_id = ? AND start_date <= ? AND end_date >= ?").bind(buildingId, date, date).first<any>();
    if (!fy || fy.status === "closed") continue;
    await postEntry(env, buildingId, userId, { date, description, source: "depreciation", status: date <= today ? "posted" : "scheduled", lines: [{ account_id: asset.expense_account_id, debit: amt }, { account_id: asset.depreciation_account_id, credit: amt }] });
    created++;
  }
  return created;
}

/** Geplande boekingen (afschrijvingen) waarvan de datum verstreken is, effectief boeken. Wordt ook door de cron aangeroepen. */
export async function postDueScheduled(env: AppEnv["Bindings"], buildingId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(`SELECT id FROM journal_entries WHERE status = 'scheduled' AND date <= ? ${buildingId ? "AND building_id = ?" : ""}`).bind(...(buildingId ? [today, buildingId] : [today])).all()).results as any[];
  if (rows.length) await env.DB.batch(rows.map((r) => env.DB.prepare("UPDATE journal_entries SET status = 'posted' WHERE id = ?").bind(r.id)));
  return rows.length;
}
ledger.post("/:buildingId/ledger/post-due", mgr, async (c) => c.json({ posted: await postDueScheduled(c.env, c.get("building").id) }));

// ---------- Bankrekeningen ----------
ledger.get("/:buildingId/ledger/bank-accounts", async (c) => c.json((await c.env.DB.prepare("SELECT ba.*, a.code, (SELECT COALESCE(SUM(jl.debit - jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE jl.account_id = ba.account_id AND je.status='posted') AS balance, (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id AND bt.status='unmatched') AS unmatched FROM bank_accounts ba JOIN accounts a ON a.id = ba.account_id WHERE ba.building_id = ? ORDER BY ba.fund DESC").bind(c.get("building").id).all()).results));
ledger.post("/:buildingId/ledger/bank-accounts", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ name: z.string().min(2).max(80), iban: z.string().max(40).nullable().optional(), fund: z.enum(["working", "reserve"]), account_code: z.string().optional() }).parse(await c.req.json());
  const acc = await c.env.DB.prepare("SELECT id FROM accounts WHERE building_id = ? AND code = ?").bind(b.id, body.account_code ?? (body.fund === "reserve" ? "550" : "551")).first<any>();
  if (!acc) throw new HttpError(400, "Grootboekrekening niet gevonden");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO bank_accounts (id, building_id, name, iban, account_id, fund) VALUES (?,?,?,?,?,?)").bind(id, b.id, body.name, body.iban?.replace(/\s/g, "") ?? null, acc.id, body.fund).run();
  return c.json({ id }, 201);
});

// ---------- Bankverrichtingen: import en matching ----------
async function insertTx(env: AppEnv["Bindings"], buildingId: string, bankAccountId: string, source: string, rows: any[]) {
  let inserted = 0;
  for (const r of rows) {
    const res = await env.DB.prepare("INSERT OR IGNORE INTO bank_transactions (id, building_id, bank_account_id, date, amount, counterparty_name, counterparty_iban, communication, structured_ref, external_ref, statement_no, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(uid(), buildingId, bankAccountId, r.date, round2(r.amount), r.counterparty_name ?? null, r.counterparty_iban ?? null, r.communication ?? null, r.structured_ref ?? null, r.external_ref ?? null, r.statement_no ?? null, source).run();
    if (res.meta.changes) inserted++;
  }
  return inserted;
}
ledger.post("/:buildingId/ledger/bank-accounts/:bankId/import", mgr, async (c) => {
  const b = c.get("building");
  const bank = await c.env.DB.prepare("SELECT * FROM bank_accounts WHERE id = ? AND building_id = ?").bind(c.req.param("bankId"), b.id).first<any>();
  if (!bank) throw new HttpError(404, "Bankrekening niet gevonden");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Geen bestand");
  const text = await file.text();
  const mapping = form.get("mapping") ? JSON.parse(String(form.get("mapping"))) : undefined;
  const isCoda = /\.cod|\.coda$/i.test(file.name) || /^0{5}\d{6}/.test(text);
  if (isCoda) {
    const r = parseCoda(text);
    if (bank.iban && r.account && !bank.iban.replace(/\s/g, "").endsWith(r.account.replace(/\s/g, "").slice(-10))) throw new HttpError(400, `CODA-bestand hoort bij rekening ${r.account}, niet bij ${bank.iban}`);
    const n = await insertTx(c.env, b.id, bank.id, "coda", r.rows);
    await audit(c.env, b.id, c.get("user").id, "bank.import", "bank_account", bank.id, { source: "coda", rows: r.rows.length, inserted: n });
    return c.json({ format: "coda", parsed: r.rows.length, inserted: n, old_balance: r.old_balance, new_balance: r.new_balance });
  }
  const r = parseBankCsv(text, mapping);
  if (!r.rows.length && !mapping) return c.json({ format: "csv", parsed: 0, inserted: 0, headers: r.headers, detected: r.detected, needs_mapping: true });
  const n = await insertTx(c.env, b.id, bank.id, "csv", r.rows);
  await audit(c.env, b.id, c.get("user").id, "bank.import", "bank_account", bank.id, { source: "csv", rows: r.rows.length, inserted: n });
  return c.json({ format: "csv", parsed: r.rows.length, inserted: n, headers: r.headers, detected: r.detected });
});
ledger.post("/:buildingId/ledger/bank-accounts/:bankId/transactions", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ date: ymd, amount: z.number(), counterparty_name: z.string().max(120).nullable().optional(), counterparty_iban: z.string().max(40).nullable().optional(), communication: z.string().max(300).nullable().optional() }).parse(await c.req.json());
  const n = await insertTx(c.env, b.id, c.req.param("bankId"), "manual", [{ ...body, structured_ref: (() => { const d = ogmDigits((body.communication ?? "").match(/\d{3}\/?\d{4}\/?\d{5}/)?.[0]); return d && d.length === 12 ? d : null; })(), external_ref: `manual:${uid()}` }]);
  return c.json({ inserted: n }, 201);
});
/** Open verrichtingen met matchvoorstellen: OGM → oproeplijn/kavel; naam+bedrag → open leveranciersfactuur; anders categorie-suggestie. */
ledger.get("/:buildingId/ledger/bank-transactions", async (c) => {
  const b = c.get("building");
  const status = c.req.query("status") ?? "unmatched";
  const txs = (await c.env.DB.prepare("SELECT bt.*, ba.name AS bank_name, ba.fund FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE bt.building_id = ? AND bt.status = ? ORDER BY bt.date DESC LIMIT 300").bind(b.id, status).all()).results as any[];
  if (status !== "unmatched") return c.json(txs);
  const callLines = (await c.env.DB.prepare("SELECT ccl.ogm, ccl.unit_id, ccl.amount, cc.fund, un.label FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id JOIN units un ON un.id = ccl.unit_id WHERE cc.building_id = ?").bind(b.id).all()).results as any[];
  const openInvoices = (await c.env.DB.prepare(`SELECT je.id, je.counterparty, je.description, je.date, (SELECT SUM(credit - debit) FROM journal_lines x JOIN accounts a ON a.id = x.account_id WHERE x.entry_id = je.id AND a.code = '440') AS amount FROM journal_entries je WHERE je.building_id = ? AND je.status = 'posted' AND je.template_code IN ('supplier_invoice','asset_purchase') ORDER BY je.date DESC LIMIT 200`).bind(b.id).all()).results as any[];
  const suppliers = (await c.env.DB.prepare("SELECT s.id, s.name, s.iban, a.code AS account_code, s.default_cost_key_id FROM suppliers s LEFT JOIN accounts a ON a.id = s.default_account_id WHERE s.building_id = ? AND s.active = 1").bind(b.id).all()).results as any[];
  const ownersByIban = (await c.env.DB.prepare("SELECT DISTINCT bt.counterparty_iban AS iban, jl.unit_id FROM bank_transactions bt JOIN journal_entries je ON je.id = bt.entry_id JOIN journal_lines jl ON jl.entry_id = je.id WHERE bt.building_id = ? AND jl.unit_id IS NOT NULL AND bt.counterparty_iban IS NOT NULL").bind(b.id).all()).results as any[];
  for (const t of txs) {
    t.suggestion = null;
    const byOgm = t.structured_ref && callLines.find((l) => ogmDigits(l.ogm) === t.structured_ref);
    if (byOgm && t.amount > 0) t.suggestion = { kind: "owner_payment", unit_id: byOgm.unit_id, unit_label: byOgm.label, fund: byOgm.fund, confidence: "high", reason: `Gestructureerde mededeling van oproep ${byOgm.fund === "reserve" ? "reservekapitaal" : "werkkapitaal"} kavel ${byOgm.label}` };
    else if (t.amount > 0 && t.counterparty_iban && ownersByIban.find((o) => o.iban === t.counterparty_iban)) { const o = ownersByIban.find((o) => o.iban === t.counterparty_iban); t.suggestion = { kind: "owner_payment", unit_id: o.unit_id, confidence: "medium", reason: "Zelfde IBAN als een eerdere bijdrage van deze kavel" }; }
    else if (t.amount < 0) {
      const inv = openInvoices.find((i) => Math.abs(round2(i.amount) - round2(-t.amount)) < 0.005 && (!t.counterparty_name || !i.counterparty || t.counterparty_name.toLowerCase().includes(i.counterparty.toLowerCase().split(" ")[0])));
      const sup = suppliers.find((x) => (t.counterparty_iban && x.iban && x.iban === t.counterparty_iban) || (t.counterparty_name && x.name && t.counterparty_name.toLowerCase().includes(x.name.toLowerCase().split(" ")[0])));
      if (inv) t.suggestion = { kind: "supplier_payment", entry_id: inv.id, counterparty: inv.counterparty, confidence: "high", reason: `Bedrag en naam komen overeen met factuur ${inv.description}` };
      else if (sup && sup.account_code) t.suggestion = { kind: "direct_expense", account_code: sup.account_code, cost_key_id: sup.default_cost_key_id, supplier: sup.name, confidence: "medium", reason: `Leverancier ${sup.name} herkend${t.counterparty_iban === sup.iban ? " op IBAN" : ""}; standaardrekening ${sup.account_code}` };
      else if (/bank|kosten|fee|beheer/i.test(t.communication ?? "") && Math.abs(t.amount) < 50) t.suggestion = { kind: "bank_fee", confidence: "low", reason: "Lijkt op bankkosten" };
      else t.suggestion = { kind: "direct_expense", confidence: "low", reason: "Kies een kostenrekening" };
    } else if (t.amount > 0 && /interest|intrest|rente/i.test(t.communication ?? "")) t.suggestion = { kind: "interest", confidence: "medium", reason: "Interesten" };
  }
  return c.json(txs);
});
/** Verrichting boeken: maakt de journaalpost volgens de gekozen aard en koppelt ze. */
ledger.post("/:buildingId/ledger/bank-transactions/:txId/match", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const tx = await c.env.DB.prepare("SELECT bt.*, ba.fund, a.code AS bank_code FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id JOIN accounts a ON a.id = ba.account_id WHERE bt.id = ? AND bt.building_id = ?").bind(c.req.param("txId"), b.id).first<any>();
  if (!tx) throw new HttpError(404, "Verrichting niet gevonden");
  if (tx.status !== "unmatched") throw new HttpError(400, "Al verwerkt");
  const body = z.object({ kind: z.enum(["owner_payment", "supplier_payment", "direct_expense", "bank_fee", "interest", "other_income", "transfer", "custom", "ignore"]), unit_id: z.string().optional(), account_code: z.string().optional(), cost_key_id: z.string().nullable().optional(), description: z.string().max(200).optional(), document_id: z.string().nullable().optional(), lines: z.array(lineSchema).optional() }).parse(await c.req.json());
  if (body.kind === "ignore") { await c.env.DB.prepare("UPDATE bank_transactions SET status = 'ignored' WHERE id = ?").bind(tx.id).run(); return c.json({ ok: true }); }
  const amt = Math.abs(tx.amount); const bankLine = tx.amount > 0 ? { account_code: tx.bank_code, debit: amt } : { account_code: tx.bank_code, credit: amt };
  let lines: LineInput[]; let description = body.description ?? "";
  switch (body.kind) {
    case "owner_payment": if (!body.unit_id) throw new HttpError(400, "Kavel ontbreekt"); if (tx.amount <= 0) throw new HttpError(400, "Een bijdrage is een ontvangst"); lines = [bankLine, { account_code: tx.fund === "reserve" ? "4100" : "4101", credit: amt, unit_id: body.unit_id }]; description ||= `Bijdrage ${tx.fund === "reserve" ? "reservekapitaal" : "werkkapitaal"} ${tx.counterparty_name ?? ""}`.trim(); break;
    case "supplier_payment": if (tx.amount >= 0) throw new HttpError(400, "Een betaling is een uitgave"); lines = [{ account_code: "440", debit: amt }, bankLine]; description ||= `Betaling ${tx.counterparty_name ?? ""}`.trim(); break;
    case "direct_expense": if (!body.account_code) throw new HttpError(400, "Kostenrekening ontbreekt"); lines = [{ account_code: body.account_code, debit: amt, cost_key_id: body.cost_key_id ?? null }, bankLine]; description ||= `${tx.counterparty_name ?? "Kost"}: ${(tx.communication ?? "").slice(0, 80)}`; break;
    case "bank_fee": lines = [{ account_code: "650", debit: amt }, bankLine]; description ||= "Bankkosten"; break;
    case "interest": lines = [bankLine, { account_code: tx.fund === "reserve" ? "751" : "752", credit: amt }]; description ||= "Creditinteresten"; break;
    case "other_income": lines = [bankLine, { account_code: body.account_code ?? "740", credit: amt }]; description ||= `Opbrengst ${tx.counterparty_name ?? ""}`.trim(); break;
    case "transfer": if (!body.account_code) throw new HttpError(400, "Tegenrekening (5xx) ontbreekt"); lines = tx.amount > 0 ? [bankLine, { account_code: body.account_code, credit: amt }] : [{ account_code: body.account_code, debit: amt }, bankLine]; description ||= "Interne overboeking"; break;
    default: if (!body.lines) throw new HttpError(400, "Lijnen ontbreken"); lines = [bankLine, ...body.lines]; description ||= tx.communication ?? "Bankverrichting";
  }
  const id = await postEntry(c.env, b.id, user.id, { date: tx.date, description, counterparty: tx.counterparty_name ?? null, source: "bank", template_code: body.kind, document_id: body.document_id ?? null, lines });
  await c.env.DB.prepare("UPDATE bank_transactions SET status = 'matched', entry_id = ? WHERE id = ?").bind(id, tx.id).run();
  return c.json({ id }, 201);
});

// ---------- Oproepen van voorschotten ----------
ledger.get("/:buildingId/ledger/calls", async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const calls = (await c.env.DB.prepare("SELECT cc.*, k.name AS cost_key_name FROM contribution_calls cc LEFT JOIN cost_keys k ON k.id = cc.cost_key_id WHERE cc.building_id = ? ORDER BY cc.date DESC").bind(b.id).all()).results as any[];
  const myUnits = isBoard(b.role) ? null : (await c.env.DB.prepare("SELECT unit_id FROM unit_owners WHERE user_id = ?").bind(user.id).all()).results.map((r: any) => r.unit_id);
  const lines = (await c.env.DB.prepare("SELECT ccl.*, un.label, cc.fund FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id JOIN units un ON un.id = ccl.unit_id WHERE cc.building_id = ?").bind(b.id).all()).results as any[];
  for (const call of calls) call.lines = lines.filter((l) => l.call_id === call.id && (!myUnits || myUnits.includes(l.unit_id)));
  return c.json(calls);
});
ledger.post("/:buildingId/ledger/calls", mgr, async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({ fund: z.enum(["working", "reserve"]), date: ymd, due_date: ymd.nullable().optional(), description: z.string().min(2).max(200), total: z.number().positive(), cost_key_id: z.string().nullable().optional(), notify: z.boolean().default(true) }).parse(await c.req.json());
  const fy = await fiscalYearFor(c.env, b.id, body.date);
  const weights = await keyWeights(c.env, b.id, body.cost_key_id ?? null);
  const parts = allocate(body.total, weights);
  if (!parts.size) throw new HttpError(400, "Geen kavels met gewicht in deze sleutel");
  const callId = uid();
  const seq = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM contribution_calls WHERE building_id = ?").bind(b.id).first<{ n: number }>();
  const units = (await c.env.DB.prepare("SELECT id, label FROM units WHERE building_id = ?").bind(b.id).all()).results as any[];
  const recv = body.fund === "reserve" ? "4100" : "4101"; const inc = body.fund === "reserve" ? "700" : "701";
  const lines: LineInput[] = []; const stmts = [];
  let i = 0;
  for (const [unitId, amount] of parts) {
    if (amount <= 0) continue;
    i++;
    const base = `${String((seq!.n + 1) % 1000).padStart(3, "0")}${String(i).padStart(4, "0")}${body.fund === "reserve" ? "9" : "1"}${String(b.id.charCodeAt(0) % 100).padStart(2, "0")}`;
    stmts.push(c.env.DB.prepare("INSERT INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES (?,?,?,?,?)").bind(uid(), callId, unitId, amount, ogm(base)));
    lines.push({ account_code: recv, debit: amount, unit_id: unitId, memo: units.find((u) => u.id === unitId)?.label });
  }
  lines.push({ account_code: inc, credit: round2([...parts.values()].reduce((s, v) => s + v, 0)) });
  const entryId = await postEntry(c.env, b.id, user.id, { date: body.date, description: `Oproep ${body.fund === "reserve" ? "reservekapitaal" : "werkkapitaal"}: ${body.description}`, source: "call", lines });
  await c.env.DB.batch([c.env.DB.prepare("INSERT INTO contribution_calls (id, building_id, fiscal_year_id, fund, date, due_date, description, total, cost_key_id, entry_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(callId, b.id, fy.id, body.fund, body.date, body.due_date ?? null, body.description, body.total, body.cost_key_id ?? null, entryId), ...stmts]);
  await audit(c.env, b.id, user.id, "ledger.call", "call", callId, { total: body.total, fund: body.fund });
  if (body.notify) {
    const owners = (await c.env.DB.prepare("SELECT uo.user_id, un.label, ccl.amount, ccl.ogm FROM contribution_call_lines ccl JOIN units un ON un.id = ccl.unit_id JOIN unit_owners uo ON uo.unit_id = ccl.unit_id WHERE ccl.call_id = ?").bind(callId).all()).results as any[];
    for (const o of owners) await notifyBuilding(c.env, { buildingId: b.id, type: "call", title: `Oproep ${body.fund === "reserve" ? "reservekapitaal" : "werkkapitaal"}: € ${o.amount.toFixed(2)} voor kavel ${o.label}`, body: `${body.description}. Betaal${body.due_date ? ` vóór ${body.due_date}` : ""} met gestructureerde mededeling ${o.ogm}.`, link: `/b/${b.id}/ledger?tab=mine`, userIds: [o.user_id] });
  }
  return c.json({ id: callId, entryId, lines: parts.size }, 201);
});

// ---------- Afrekening per kavel / eigenaar ----------
export async function ownerStatement(env: AppEnv["Bindings"], buildingId: string, fyId: string, unitIds: string[] | null) {
  const b = { id: buildingId };
  const fy = await env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(fyId, b.id).first<any>();
  if (!fy) throw new HttpError(404, "Boekjaar niet gevonden");
  const units = (await env.DB.prepare("SELECT un.*, (SELECT GROUP_CONCAT(u.name, ', ') FROM unit_owners uo JOIN users u ON u.id = uo.user_id WHERE uo.unit_id = un.id) AS owners FROM units un WHERE un.building_id = ? ORDER BY un.label").bind(b.id).all()).results as any[];
  // kosten per sleutel verdelen
  const costLines = (await env.DB.prepare(`SELECT jl.cost_key_id, a.code, a.name, jl.memo, SUM(jl.debit - jl.credit) AS amount FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.fiscal_year_id = ? AND je.status = 'posted' AND a.class = 6 AND a.code NOT IN ('693') GROUP BY jl.cost_key_id, a.code, a.name, jl.memo`).bind(fy.id).all()).results as any[];
  const keyCache = new Map<string | null, Map<string, number>>();
  const costByUnit = new Map<string, Map<string, { name: string; amount: number }>>();
  for (const cl of costLines) {
    const k = cl.cost_key_id ?? null;
    if (!keyCache.has(k)) keyCache.set(k, await keyWeights(env, b.id, k));
    const parts = allocate(round2(cl.amount), keyCache.get(k)!);
    for (const [uid_, amt] of parts) { if (!costByUnit.has(uid_)) costByUnit.set(uid_, new Map()); const m = costByUnit.get(uid_)!; const cur = m.get(cl.code) ?? { name: cl.name, amount: 0 }; cur.amount = round2(cur.amount + amt); m.set(cl.code, cur); }
  }
  // oproepen en betalingen per kavel (410x)
  const recv = (await env.DB.prepare(`SELECT jl.unit_id, a.fund, SUM(jl.debit) AS called, SUM(jl.credit) AS paid FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.fiscal_year_id = ? AND je.status = 'posted' AND a.code IN ('4100','4101') AND jl.unit_id IS NOT NULL GROUP BY jl.unit_id, a.fund`).bind(fy.id).all()).results as any[];
  const openingBalances = (await env.DB.prepare(`SELECT jl.unit_id, SUM(jl.debit - jl.credit) AS bal FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.status = 'posted' AND a.code IN ('4100','4101') AND jl.unit_id IS NOT NULL AND je.date < ? GROUP BY jl.unit_id`).bind(b.id, fy.start_date).all()).results as any[];
  const out = units.filter((u) => !unitIds || unitIds.includes(u.id)).map((u) => {
    const costs = [...(costByUnit.get(u.id)?.entries() ?? [])].map(([code, v]) => ({ code, ...v })).sort((a, c2) => a.code.localeCompare(c2.code));
    const totalCost = round2(costs.reduce((s, x) => s + x.amount, 0));
    const w = recv.find((r) => r.unit_id === u.id && r.fund === "working"); const r = recv.find((x) => x.unit_id === u.id && x.fund === "reserve");
    const opening = round2(openingBalances.find((o) => o.unit_id === u.id)?.bal ?? 0);
    const calledW = round2(w?.called ?? 0), paidW = round2(w?.paid ?? 0), calledR = round2(r?.called ?? 0), paidR = round2(r?.paid ?? 0);
    return { unit_id: u.id, label: u.label, shares: u.shares, owners: u.owners, costs, total_cost: totalCost, working: { called: calledW, paid: paidW }, reserve: { called: calledR, paid: paidR }, opening_balance: opening,
      outstanding: round2(opening + calledW + calledR - paidW - paidR), // nog te betalen oproepen
      result: round2(calledW - totalCost) }; // + = te veel voorschot (terug/over te dragen), - = bij te passen
  });
  return { fiscal_year: fy, units: out, total_cost: round2(out.reduce((s, u) => s + u.total_cost, 0)) };
}
ledger.get("/:buildingId/ledger/statements/:fyId", async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (isBoard(b.role)) return c.json(await ownerStatement(c.env, b.id, c.req.param("fyId"), null));
  const mine = (await c.env.DB.prepare("SELECT unit_id FROM unit_owners WHERE user_id = ?").bind(user.id).all()).results.map((r: any) => r.unit_id);
  return c.json(await ownerStatement(c.env, b.id, c.req.param("fyId"), mine));
});

// ---------- Begroting ----------
ledger.get("/:buildingId/ledger/budgets/:fyId", async (c) => {
  const b = c.get("building");
  const budget = await c.env.DB.prepare("SELECT bu.*, m.title AS meeting_title FROM budgets bu LEFT JOIN meetings m ON m.id = bu.approved_meeting_id WHERE bu.building_id = ? AND bu.fiscal_year_id = ?").bind(b.id, c.req.param("fyId")).first<any>();
  const lines = budget ? (await c.env.DB.prepare("SELECT bl.*, a.code, a.name AS account_name FROM budget_lines bl JOIN accounts a ON a.id = bl.account_id WHERE bl.budget_id = ? ORDER BY a.code").bind(budget.id).all()).results : [];
  const actual = (await c.env.DB.prepare("SELECT a.id AS account_id, a.code, SUM(jl.debit - jl.credit) AS amount FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.fiscal_year_id = ? AND je.status = 'posted' AND a.class = 6 GROUP BY a.id").bind(c.req.param("fyId")).all()).results as any[];
  const prev = await c.env.DB.prepare("SELECT id FROM fiscal_years WHERE building_id = ? AND end_date < (SELECT start_date FROM fiscal_years WHERE id = ?) ORDER BY end_date DESC LIMIT 1").bind(b.id, c.req.param("fyId")).first<any>();
  const previous = prev ? (await c.env.DB.prepare("SELECT a.id AS account_id, SUM(jl.debit - jl.credit) AS amount FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.fiscal_year_id = ? AND je.status = 'posted' AND a.class = 6 GROUP BY a.id").bind(prev.id).all()).results as any[] : [];
  return c.json({ budget, lines, actual, previous });
});
ledger.put("/:buildingId/ledger/budgets/:fyId", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ notes: z.string().max(5000).nullable().optional(), lines: z.array(z.object({ account_id: z.string(), kind: z.enum(["ordinary", "extraordinary"]).default("ordinary"), amount: z.number().min(0), cost_key_id: z.string().nullable().optional(), memo: z.string().max(200).nullable().optional() })) }).parse(await c.req.json());
  let budget = await c.env.DB.prepare("SELECT * FROM budgets WHERE building_id = ? AND fiscal_year_id = ?").bind(b.id, c.req.param("fyId")).first<any>();
  if (budget?.status === "approved") throw new HttpError(400, "Een goedgekeurde begroting kan niet meer gewijzigd worden");
  const id = budget?.id ?? uid();
  await c.env.DB.batch([
    budget ? c.env.DB.prepare("UPDATE budgets SET notes = ? WHERE id = ?").bind(body.notes ?? null, id) : c.env.DB.prepare("INSERT INTO budgets (id, building_id, fiscal_year_id, notes) VALUES (?,?,?,?)").bind(id, b.id, c.req.param("fyId"), body.notes ?? null),
    c.env.DB.prepare("DELETE FROM budget_lines WHERE budget_id = ?").bind(id),
    ...body.lines.filter((l) => l.amount > 0).map((l) => c.env.DB.prepare("INSERT INTO budget_lines (id, budget_id, account_id, kind, amount, cost_key_id, memo) VALUES (?,?,?,?,?,?,?)").bind(uid(), id, l.account_id, l.kind, l.amount, l.cost_key_id ?? null, l.memo ?? null)),
  ]);
  return c.json({ id });
});
ledger.post("/:buildingId/ledger/budgets/:fyId/approve", mgr, async (c) => {
  const b = c.get("building");
  const { meeting_id } = z.object({ meeting_id: z.string().nullable().optional() }).parse(await c.req.json().catch(() => ({})));
  await c.env.DB.prepare("UPDATE budgets SET status = 'approved', approved_meeting_id = ? WHERE building_id = ? AND fiscal_year_id = ?").bind(meeting_id ?? null, b.id, c.req.param("fyId")).run();
  await audit(c.env, b.id, c.get("user").id, "ledger.budget_approve", "fiscal_year", c.req.param("fyId"));
  return c.json({ ok: true });
});

// ---------- Rapporten ----------
/** Draaitabel-basis: saldo per rekening per periode (maand) voor een boekjaar. De client groepeert verder. */
ledger.get("/:buildingId/ledger/reports/pivot/:fyId", async (c) => {
  const b = c.get("building");
  const rows = (await c.env.DB.prepare(`SELECT a.code, a.name, a.class, a.type, a.fund, je.period, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit, (SELECT g.name FROM accounts g WHERE g.building_id = a.building_id AND g.code = substr(a.code, 1, 3)) AS group_name FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.fiscal_year_id = ? AND je.status = 'posted' GROUP BY a.code, je.period ORDER BY a.code, je.period`).bind(b.id, c.req.param("fyId")).all()).results as any[];
  return c.json(rows.map((r) => ({ ...r, net: round2(r.type === "asset" || r.type === "expense" ? r.debit - r.credit : r.credit - r.debit), group: r.code.slice(0, 3), quarter: `${r.period.slice(0, 4)}-Q${Math.ceil(parseInt(r.period.slice(5), 10) / 3)}` })));
});
/** Balans, resultatenrekening en kas- en kapitaalpositie op een datum. */
ledger.get("/:buildingId/ledger/reports/summary", async (c) => c.json(await summary(c.env, c.get("building").id, c.req.query("fy") ?? null, c.req.query("until") ?? new Date().toISOString().slice(0, 10))));
export async function summary(env: AppEnv["Bindings"], buildingId: string, fyId: string | null, until: string) {
  const b = { id: buildingId };
  const fy = fyId ? await env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(fyId, b.id).first<any>() : null;
  const bal = (await env.DB.prepare(`SELECT a.code, a.name, a.class, a.type, a.fund, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.status = 'posted' AND je.date <= ? GROUP BY a.code HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.004 ORDER BY a.code`).bind(b.id, until).all()).results as any[];
  const pl = fy ? (await env.DB.prepare(`SELECT a.code, a.name, a.class, a.type, a.fund, jl.memo, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.fiscal_year_id = ? AND je.status = 'posted' AND a.class IN (6,7) GROUP BY a.code, jl.memo ORDER BY a.code`).bind(fy.id).all()).results as any[] : [];
  const assets = bal.filter((r) => r.type === "asset").map((r) => ({ ...r, amount: round2(r.debit - r.credit) }));
  const liabilities = bal.filter((r) => r.type === "liability" || r.type === "equity").map((r) => ({ ...r, amount: round2(r.credit - r.debit) }));
  const expenses = pl.filter((r) => r.type === "expense" && r.code !== "693"); const income = pl.filter((r) => r.type === "income" && r.code !== "793");
  const sum = (xs: any[], f: (r: any) => number) => round2(xs.reduce((s, r) => s + f(r), 0));
  const totExp = sum(expenses, (r) => r.debit - r.credit), totInc = sum(income, (r) => r.credit - r.debit);
  const bank = (code: string) => round2(assets.filter((r) => r.code === code).reduce((s, r) => s + r.amount, 0));
  const recvOpen = round2(assets.filter((r) => r.code.startsWith("410")).reduce((s, r) => s + r.amount, 0));
  const plResult = round2(totInc - totExp);
  // resultaat (nog niet overgedragen) hoort bij het passief zodat actief = passief
  const totAssets = sum(assets, (r) => r.amount), totLiab = sum(liabilities, (r) => r.amount);
  return ({ until, fiscal_year: fy, balance: { assets, liabilities, total_assets: totAssets, total_liabilities: totLiab, unallocated_result: round2(totAssets - totLiab) },
    result: { expenses: expenses.map((r) => ({ ...r, amount: round2(r.debit - r.credit) })), income: income.map((r) => ({ ...r, amount: round2(r.credit - r.debit) })), total_expenses: totExp, total_income: totInc, result: plResult },
    cash: { reserve_bank: bank("550"), working_bank: bank("551"), other_bank: bank("552") + bank("570"), deposits: round2(assets.filter((r) => r.code.startsWith("53")).reduce((s, r) => s + r.amount, 0)), open_receivables: recvOpen, suppliers_open: round2(liabilities.filter((r) => r.code === "440").reduce((s, r) => s + r.amount, 0)), reserve_carried: round2(liabilities.filter((r) => r.code === "48901").reduce((s, r) => s + r.amount, 0)), working_carried: round2(liabilities.filter((r) => r.code === "48902").reduce((s, r) => s + r.amount, 0)) } });
}
ledger.get("/:buildingId/ledger/reports/export.csv", async (c) => {
  const b = c.get("building");
  const fyId = c.req.query("fy");
  const rows = (await c.env.DB.prepare(`SELECT je.number, je.date, je.description, je.counterparty, je.status, a.code, a.name, jl.debit, jl.credit, un.label AS unit, jl.memo FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id LEFT JOIN units un ON un.id = jl.unit_id WHERE je.building_id = ? ${fyId ? "AND je.fiscal_year_id = ?" : ""} ORDER BY je.date, je.number, jl.position`).bind(...(fyId ? [b.id, fyId] : [b.id])).all()).results as any[];
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["nummer;datum;omschrijving;tegenpartij;status;rekening;benaming;debet;credit;kavel;memo", ...rows.map((r) => [r.number, r.date, esc(r.description), esc(r.counterparty), r.status, r.code, esc(r.name), r.debit.toFixed(2).replace(".", ","), r.credit.toFixed(2).replace(".", ","), esc(r.unit), esc(r.memo)].join(";"))].join("\n");
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dagboek.csv"` } });
});

export default ledger;
