import type { Env } from "../env";
import { round2 } from "./ledger";
import { addMonths } from "./decisions";

/**
 * Controle verplicht reservekapitaal (art. 3.86 §3 BW, tekst geverifieerd 2026-10-17).
 * Gewone gemeenschappelijke lasten van het vorige boekjaar = kosten (klasse 6) zonder afschrijvingen (63), op basis van de geboekte posten.
 * Bijdrage van dit boekjaar = de oproepen reservekapitaal (fonds 'reserve') met datum in het boekjaar.
 */
export interface ReserveCheck {
  status: "no_date" | "not_yet" | "waived" | "ok" | "short" | "no_previous_year";
  obligation_from: string | null; fiscal_year: string | null; previous_year: string | null;
  ordinary_charges_prev: number; minimum: number; called_reserve: number;
  has_working_account: boolean; has_reserve_account: boolean; waiver: { title: string; decided_on: string } | null; message: string;
}

export async function reserveCheck(env: Env, buildingId: string, fyId?: string | null): Promise<ReserveCheck> {
  const b = await env.DB.prepare("SELECT provisional_acceptance_date, reserve_waiver_item_id FROM buildings WHERE id = ?").bind(buildingId).first<any>();
  const fy = fyId ? await env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(fyId, buildingId).first<any>()
    : await env.DB.prepare("SELECT * FROM fiscal_years WHERE building_id = ? AND start_date <= date('now') AND end_date >= date('now')").bind(buildingId).first<any>();
  const accounts = (await env.DB.prepare("SELECT fund FROM bank_accounts WHERE building_id = ?").bind(buildingId).all<{ fund: string }>()).results;
  const base = { has_working_account: accounts.some((a) => a.fund === "working"), has_reserve_account: accounts.some((a) => a.fund === "reserve"), fiscal_year: fy?.label ?? null };
  const waiverRow = b?.reserve_waiver_item_id ? await env.DB.prepare("SELECT a.title, COALESCE(m.starts_at, a.voted_at) AS decided_on FROM agenda_items a LEFT JOIN meetings m ON m.id = a.meeting_id WHERE a.id = ?").bind(b.reserve_waiver_item_id).first<any>() : null;
  const waiver = waiverRow ? { title: waiverRow.title, decided_on: String(waiverRow.decided_on).slice(0, 10) } : null;
  const empty = { ordinary_charges_prev: 0, minimum: 0, called_reserve: 0, previous_year: null };
  if (!b?.provisional_acceptance_date) return { ...base, ...empty, status: "no_date", obligation_from: null, waiver, message: "Datum van de voorlopige oplevering van de gemeenschappelijke delen ontbreekt; vul ze in onder Instellingen om de verplichting van art. 3.86 §3 te controleren." };
  const from = addMonths(b.provisional_acceptance_date, 60);
  if (!fy) return { ...base, ...empty, status: "no_previous_year", obligation_from: from, waiver, message: "Geen lopend boekjaar." };
  if (fy.end_date < from) return { ...base, ...empty, status: "not_yet", obligation_from: from, waiver, message: `Verplicht reservekapitaal vanaf ${from} (5 jaar na de voorlopige oplevering).` };
  if (waiver) return { ...base, ...empty, status: "waived", obligation_from: from, waiver, message: `De algemene vergadering besliste met 4/5 geen verplicht reservekapitaal aan te leggen (${waiver.title}, ${waiver.decided_on}).` };
  const prev = await env.DB.prepare("SELECT * FROM fiscal_years WHERE building_id = ? AND end_date < ? ORDER BY end_date DESC LIMIT 1").bind(buildingId, fy.start_date).first<any>();
  const called = round2((await env.DB.prepare("SELECT COALESCE(SUM(total),0) AS s FROM contribution_calls WHERE building_id = ? AND fund = 'reserve' AND date >= ? AND date <= ?").bind(buildingId, fy.start_date, fy.end_date).first<{ s: number }>())?.s ?? 0);
  if (!prev) return { ...base, ordinary_charges_prev: 0, minimum: 0, called_reserve: called, previous_year: null, status: "no_previous_year", obligation_from: from, waiver, message: "Geen vorig boekjaar in Trustee: de minimumbijdrage (5 % van de gewone lasten van het vorige boekjaar) kan niet berekend worden." };
  const charges = round2((await env.DB.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS s FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.fiscal_year_id = ? AND je.status = 'posted' AND a.code LIKE '6%' AND a.code NOT LIKE '63%'").bind(buildingId, prev.id).first<{ s: number }>())?.s ?? 0);
  const minimum = round2(charges * 0.05);
  const ok = called + 0.005 >= minimum;
  return { ...base, ordinary_charges_prev: charges, minimum, called_reserve: called, previous_year: prev.label, status: ok ? "ok" : "short", obligation_from: from, waiver,
    message: ok ? `Reservekapitaal ${fy.label}: ${called.toFixed(2)} opgevraagd, minimum ${minimum.toFixed(2)} (5 % van ${charges.toFixed(2)} gewone lasten ${prev.label}).` : `Te weinig reservekapitaal opgevraagd in ${fy.label}: ${called.toFixed(2)}, wettelijk minimum ${minimum.toFixed(2)} (5 % van ${charges.toFixed(2)} gewone lasten ${prev.label}, art. 3.86 §3 BW). Vraag het verschil op of laat de AV met 4/5 anders beslissen.` };
}
