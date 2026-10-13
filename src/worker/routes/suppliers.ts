import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, patchOf, uid } from "../lib/util";
import { audit } from "../lib/notify";
import { postEntry, templateByCode } from "../lib/ledger";

const r = new Hono<AppEnv>();
r.use("*", requireAuth);
const mgr = requireBuilding("syndicus");

// ---------- Leveranciers ----------
const supplierSchema = z.object({ name: z.string().min(2).max(160), category: z.string().max(60).nullable().optional(), iban: z.string().max(40).nullable().optional(), vat: z.string().max(30).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal("")), phone: z.string().max(40).nullable().optional(), address: z.string().max(300).nullable().optional(), default_account_code: z.string().nullable().optional(), default_cost_key_id: z.string().nullable().optional(), contract_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), notes: z.string().max(3000).nullable().optional(), active: z.boolean().optional() });

r.get("/:buildingId/suppliers", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = (await c.env.DB.prepare(`SELECT s.*, a.code AS default_account_code, a.name AS default_account_name, k.name AS default_cost_key_name,
      (SELECT COUNT(*) FROM posts p WHERE p.supplier_id = s.id AND p.status IN ('open','in_progress')) AS open_tickets,
      (SELECT COALESCE(SUM(jl.debit),0) FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts x ON x.id = jl.account_id WHERE je.building_id = s.building_id AND je.status = 'posted' AND je.counterparty = s.name AND x.class = 6 AND je.date >= date('now','-365 days')) AS spent_12m
     FROM suppliers s LEFT JOIN accounts a ON a.id = s.default_account_id LEFT JOIN cost_keys k ON k.id = s.default_cost_key_id WHERE s.building_id = ? ORDER BY s.active DESC, s.name`).bind(b.id).all()).results;
  return c.json(rows);
});
async function accountId(c: Context<AppEnv>, code: string | null | undefined) { if (!code) return null; const a = await c.env.DB.prepare("SELECT id FROM accounts WHERE building_id = ? AND code = ?").bind(c.get("building").id, code).first<any>(); return a?.id ?? null; }
r.post("/:buildingId/suppliers", mgr, async (c) => {
  const b = c.get("building"); const body = supplierSchema.parse(await c.req.json()); const id = uid();
  await c.env.DB.prepare("INSERT INTO suppliers (id, building_id, name, category, iban, vat, email, phone, address, default_account_id, default_cost_key_id, contract_until, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, body.name, body.category ?? null, body.iban?.replace(/\s/g, "") || null, body.vat ?? null, body.email || null, body.phone ?? null, body.address ?? null, await accountId(c, body.default_account_code), body.default_cost_key_id ?? null, body.contract_until ?? null, body.notes ?? null).run();
  return c.json({ id }, 201);
});
r.patch("/:buildingId/suppliers/:id", mgr, async (c) => {
  const b = c.get("building"); const body = patchOf(supplierSchema.partial(), await c.req.json());
  const { default_account_code, ...rest } = body as any;
  const fields: [string, unknown][] = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : k === "iban" && v ? String(v).replace(/\s/g, "") : v === "" ? null : v]);
  if (default_account_code !== undefined) fields.push(["default_account_id", await accountId(c, default_account_code)]);
  if (fields.length) await c.env.DB.prepare(`UPDATE suppliers SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("id"), b.id).run();
  return c.json({ ok: true });
});
r.delete("/:buildingId/suppliers/:id", mgr, async (c) => { await c.env.DB.prepare("UPDATE suppliers SET active = 0 WHERE id = ? AND building_id = ?").bind(c.req.param("id"), c.get("building").id).run(); return c.json({ ok: true }); });

// ---------- Periodieke boekingen ----------
const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
function advance(date: string, months: number) { const d = new Date(date + "T00:00:00Z"); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); }

r.get("/:buildingId/ledger/recurring", requireBuilding("syndicus", "raad", "commissaris"), async (c) => c.json((await c.env.DB.prepare("SELECT * FROM recurring_entries WHERE building_id = ? ORDER BY active DESC, next_date").bind(c.get("building").id).all()).results.map((x: any) => ({ ...x, params: JSON.parse(x.params) }))));
r.post("/:buildingId/ledger/recurring", mgr, async (c) => {
  const b = c.get("building");
  const body = z.object({ name: z.string().min(2).max(120), template_code: z.string(), params: z.record(z.string(), z.any()), frequency: z.enum(["monthly", "quarterly", "halfyearly", "yearly"]), next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(await c.req.json());
  if (!templateByCode(body.template_code)) throw new HttpError(400, "Onbekende handeling");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO recurring_entries (id, building_id, name, template_code, params, frequency, next_date, end_date, created_by) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, b.id, body.name, body.template_code, JSON.stringify(body.params), body.frequency, body.next_date, body.end_date ?? null, c.get("user").id).run();
  return c.json({ id }, 201);
});
r.patch("/:buildingId/ledger/recurring/:id", mgr, async (c) => {
  const body = z.object({ active: z.boolean().optional(), next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), params: z.record(z.string(), z.any()).optional(), name: z.string().min(2).max(120).optional() }).parse(await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : k === "params" ? JSON.stringify(v) : v]);
  if (fields.length) await c.env.DB.prepare(`UPDATE recurring_entries SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? AND building_id = ?`).bind(...fields.map(([, v]) => v), c.req.param("id"), c.get("building").id).run();
  return c.json({ ok: true });
});
r.delete("/:buildingId/ledger/recurring/:id", mgr, async (c) => { await c.env.DB.prepare("DELETE FROM recurring_entries WHERE id = ? AND building_id = ?").bind(c.req.param("id"), c.get("building").id).run(); return c.json({ ok: true }); });

/** Boekt één periodieke post (nu of via cron) en schuift de volgende datum op. */
export async function runRecurring(env: AppEnv["Bindings"], row: any, date?: string): Promise<string | null> {
  const t = templateByCode(row.template_code); if (!t) return null;
  const params = typeof row.params === "string" ? JSON.parse(row.params) : row.params;
  const bankRow = async (id: string) => { const x = await env.DB.prepare("SELECT ba.fund, a.code FROM bank_accounts ba JOIN accounts a ON a.id = ba.account_id WHERE ba.id = ? AND ba.building_id = ?").bind(id, row.building_id).first<any>(); if (!x) throw new HttpError(400, "Bankrekening niet gevonden"); return x; };
  const built = await t.build(params, { bankCodeFor: async (id) => (await bankRow(id)).code, fundOf: async (id) => (await bankRow(id)).fund });
  const d = date ?? row.next_date;
  const id = await postEntry(env, row.building_id, row.created_by ?? null, { date: d, description: `${built.description} (periodiek: ${row.name})`, counterparty: built.counterparty ?? null, document_id: null, template_code: t.code, source: "template", lines: built.lines });
  const next = advance(row.next_date, FREQ_MONTHS[row.frequency]);
  const stillActive = !row.end_date || next <= row.end_date;
  await env.DB.prepare("UPDATE recurring_entries SET next_date = ?, last_run = ?, last_entry_id = ?, active = ? WHERE id = ?").bind(next, new Date().toISOString(), id, stillActive ? 1 : 0, row.id).run();
  return id;
}
r.post("/:buildingId/ledger/recurring/:id/run", mgr, async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM recurring_entries WHERE id = ? AND building_id = ?").bind(c.req.param("id"), c.get("building").id).first<any>();
  if (!row) throw new HttpError(404, "Niet gevonden");
  const entryId = await runRecurring(c.env, row, new Date().toISOString().slice(0, 10) < row.next_date ? new Date().toISOString().slice(0, 10) : row.next_date);
  await audit(c.env, row.building_id, c.get("user").id, "ledger.recurring_run", "recurring", row.id);
  return c.json({ entryId });
});
/** Cron: alle vervallen periodieke posten boeken. */
export async function runDueRecurring(env: AppEnv["Bindings"]) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await env.DB.prepare("SELECT * FROM recurring_entries WHERE active = 1 AND next_date <= ?").bind(today).all()).results as any[];
  let n = 0; for (const row of rows) { try { await runRecurring(env, row); n++; } catch (e) { console.error("recurring failed", row.id, e); } }
  return n;
}

export default r;
