import type { Env } from "../env";
import { round2 } from "./ledger";

/** Aantal kavels die meetellen voor de 20-kavelgrens (kelders, garages en parkeerplaatsen niet). */
export async function countedUnits(env: Env, buildingId: string) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM units WHERE building_id = ? AND type NOT IN ('garage','berging','kelder','parkeerplaats')").bind(buildingId).first<{ n: number }>())?.n ?? 0;
}
/** Effectieve modus: 'simple' (kasboek) of 'double' (volledig). 'auto' = eenvoudig onder 20 kavels. */
export async function ledgerMode(env: Env, buildingId: string): Promise<"simple" | "double"> {
  const b = await env.DB.prepare("SELECT ledger_mode FROM buildings WHERE id = ?").bind(buildingId).first<{ ledger_mode: string }>();
  if (b?.ledger_mode === "simple" || b?.ledger_mode === "double") return b.ledger_mode;
  return (await countedUnits(env, buildingId)) < 20 ? "simple" : "double";
}

/**
 * Kasboek: elke beweging op bank of kas (klasse 5) met de tegenrekening als rubriek, lopend saldo per rekening,
 * totalen per rubriek en de positie van werk- en reservekapitaal. Dit is de wettelijke minimuminhoud van de
 * vereenvoudigde boekhouding (ontvangsten, uitgaven, kaspositie, werk- en reservekapitaal).
 */
export async function cashbook(env: Env, buildingId: string, fyId: string) {
  const fy = await env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(fyId, buildingId).first<any>();
  const rows = (await env.DB.prepare(`SELECT je.id AS entry_id, je.number, je.date, je.description, je.counterparty, je.document_id, a.code AS bank_code, a.name AS bank_name, a.fund, jl.debit, jl.credit,
      (SELECT GROUP_CONCAT(DISTINCT xa.code || ' ' || xa.name) FROM journal_lines x JOIN accounts xa ON xa.id = x.account_id WHERE x.entry_id = je.id AND xa.class != 5) AS counter,
      (SELECT MIN(xa.class) FROM journal_lines x JOIN accounts xa ON xa.id = x.account_id WHERE x.entry_id = je.id AND xa.class != 5) AS counter_class,
      (SELECT GROUP_CONCAT(DISTINCT un.label) FROM journal_lines x JOIN units un ON un.id = x.unit_id WHERE x.entry_id = je.id) AS units
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
     WHERE je.building_id = ? AND je.fiscal_year_id = ? AND je.status = 'posted' AND a.class = 5 AND a.code NOT LIKE '58%'
     ORDER BY je.date, je.number`).bind(buildingId, fyId).all()).results as any[];
  const opening = (await env.DB.prepare("SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) AS bal FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.status = 'posted' AND a.class = 5 AND je.date < ? GROUP BY a.code").bind(buildingId, fy.start_date).all()).results as any[];
  const bal: Record<string, number> = {}; for (const o of opening) bal[o.code] = round2(o.bal);
  const movements = rows.map((r) => { const amount = round2(r.debit - r.credit); bal[r.bank_code] = round2((bal[r.bank_code] ?? 0) + amount); const kind = amount >= 0 ? "in" : "out"; const rubriek = r.counter_class === 4 && /410/.test(r.counter ?? "") ? "Bijdragen van mede-eigenaars" : r.counter_class === 4 && /440/.test(r.counter ?? "") ? "Betaling leveranciers" : r.counter_class === 6 ? "Kosten" : r.counter_class === 7 ? "Opbrengsten" : r.counter_class === 2 ? "Investeringen" : "Overig"; return { ...r, amount, kind, rubriek, category: (r.counter ?? "").split(",")[0], balance_after: bal[r.bank_code] }; });
  const byRubriek: Record<string, { in: number; out: number }> = {};
  for (const m of movements) { const k = m.category || m.rubriek; byRubriek[k] ??= { in: 0, out: 0 }; if (m.amount >= 0) byRubriek[k].in = round2(byRubriek[k].in + m.amount); else byRubriek[k].out = round2(byRubriek[k].out - m.amount); }
  const totalIn = round2(movements.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0)), totalOut = round2(movements.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0));
  const accounts = (await env.DB.prepare("SELECT a.code, a.name, a.fund FROM accounts a WHERE a.building_id = ? AND a.class = 5 AND a.is_header = 0 ORDER BY a.code").bind(buildingId).all()).results as any[];
  const position = accounts.map((a) => ({ ...a, opening: round2(opening.find((o) => o.code === a.code)?.bal ?? 0), closing: round2(bal[a.code] ?? opening.find((o) => o.code === a.code)?.bal ?? 0) })).filter((a) => a.opening !== 0 || a.closing !== 0);
  const receivable = (await env.DB.prepare("SELECT a.fund, COALESCE(SUM(jl.debit - jl.credit),0) AS open FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.status = 'posted' AND a.code IN ('4100','4101') GROUP BY a.fund").bind(buildingId).all()).results as any[];
  const capital = { working: round2(position.filter((p) => p.fund === "working").reduce((s, p) => s + p.closing, 0)), reserve: round2(position.filter((p) => p.fund === "reserve").reduce((s, p) => s + p.closing, 0)), working_receivable: round2(receivable.find((r) => r.fund === "working")?.open ?? 0), reserve_receivable: round2(receivable.find((r) => r.fund === "reserve")?.open ?? 0) };
  return { fiscal_year: fy, movements, by_rubriek: Object.entries(byRubriek).map(([k, v]) => ({ rubriek: k, ...v })).sort((a, b) => a.rubriek.localeCompare(b.rubriek)), total_in: totalIn, total_out: totalOut, position, capital };
}
