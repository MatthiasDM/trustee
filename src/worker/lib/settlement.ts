import type { Env } from "../env";
import { HttpError } from "./util";
import { round2 } from "./ledger";

/**
 * Afrekening bij overdracht van een kavel (tekst geverifieerd 2026-10-16):
 * - art. 3.94 §5, 1°: de verkoper is schuldeiser van de VME voor het deel van zijn aandeel in het werkkapitaal dat overeenstemt met de periode
 *   waarin hij de gemeenschappelijke delen niet meer kan gebruiken; de syndicus stelt de afrekening op; het aandeel wordt terugbetaald aan de
 *   verkoper en opgevraagd bij de koper;
 * - art. 3.94 §5, 2°: zijn aandeel in het reservekapitaal blijft eigendom van de VME;
 * - art. 3.94 §2: gewone lasten draagt de koper vanaf de dag dat hij de gemeenschappelijke delen kan gebruiken; beslist vóór de overdracht maar
 *   pas nadien opgevraagd: ten laste van de koper, behoudens andersluidende afspraak tussen partijen;
 * - art. 3.95: de notaris houdt de achterstallen van de verkoper (met invorderingskosten) af bij het verlijden van de akte.
 * Pro rata: opgevraagd werkkapitaal van het boekjaar × (dagen vanaf de overdrachtsdatum tot het einde van het boekjaar) / (dagen van het boekjaar).
 */
export interface SettlementPreview {
  unit: { id: string; label: string; shares: number };
  sellers: { user_id: string; name: string }[];
  transfer_date: string; fiscal_year: { id: string; label: string; start_date: string; end_date: string };
  days_after: number; fy_days: number;
  working_called: number; working_refund: number; reserve_paid: number;
  arrears_working: number; arrears_reserve: number; fees: number; arrears_total: number;
  pending_decisions: { title: string; decided_on: string; decision: string | null }[];
  iban: string | null;
}

const days = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400_000);

export async function settlementPreview(env: Env, buildingId: string, unitId: string, transferDate: string): Promise<SettlementPreview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) throw new HttpError(400, "Ongeldige overdrachtsdatum");
  const unit = await env.DB.prepare("SELECT id, label, shares, parent_unit_id FROM units WHERE id = ? AND building_id = ?").bind(unitId, buildingId).first<any>();
  if (!unit) throw new HttpError(404, "Kavel niet gevonden");
  const sellers = (await env.DB.prepare("SELECT uo.user_id, u.name FROM unit_owners uo JOIN users u ON u.id = uo.user_id WHERE uo.unit_id = ? ORDER BY u.name").bind(unitId).all()).results as any[];
  if (!sellers.length) throw new HttpError(400, "Deze kavel heeft geen geregistreerde eigenaar");
  const fy = await env.DB.prepare("SELECT id, label, start_date, end_date FROM fiscal_years WHERE building_id = ? AND start_date <= ? AND end_date >= ?").bind(buildingId, transferDate, transferDate).first<any>();
  if (!fy) throw new HttpError(400, `Geen boekjaar voor ${transferDate}. Maak eerst een boekjaar aan.`);
  const called = (fund: string) => env.DB.prepare("SELECT COALESCE(SUM(ccl.amount),0) AS s FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id WHERE ccl.unit_id = ? AND cc.building_id = ? AND cc.fund = ? AND cc.date >= ? AND cc.date <= ? AND cc.description NOT LIKE 'Werkkapitaal bij overdracht%'").bind(unitId, buildingId, fund, fy.start_date, fy.end_date).first<{ s: number }>();
  const open = (code: string) => env.DB.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS s FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE jl.unit_id = ? AND a.building_id = ? AND a.code = ? AND je.status = 'posted' AND je.date <= ?").bind(unitId, buildingId, code, transferDate).first<{ s: number }>();
  const reservePaidRow = await env.DB.prepare("SELECT COALESCE(SUM(jl.credit),0) AS s FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE jl.unit_id = ? AND a.building_id = ? AND a.code = '4100' AND je.status = 'posted' AND je.date <= ?").bind(unitId, buildingId, transferDate).first<{ s: number }>();
  const fees = (await env.DB.prepare("SELECT COALESCE(SUM(fee),0) AS s FROM payment_reminders WHERE unit_id = ? AND sent_at <= ?").bind(unitId, `${transferDate}T23:59:59Z`).first<{ s: number }>())?.s ?? 0;
  const workingCalled = round2((await called("working"))?.s ?? 0);
  const fyDays = days(fy.start_date, fy.end_date) + 1;
  const daysAfter = Math.max(0, days(transferDate, fy.end_date) + 1);
  const arrearsW = Math.max(0, round2((await open("4101"))?.s ?? 0)); const arrearsR = Math.max(0, round2((await open("4100"))?.s ?? 0));
  const pending = (await env.DB.prepare("SELECT a.title, a.decision, COALESCE(m.starts_at, a.voted_at) AS decided_on FROM agenda_items a LEFT JOIN meetings m ON m.id = a.meeting_id WHERE a.building_id = ? AND a.status = 'decided' AND a.adopted = 1 AND a.kind IN ('works','demolition') AND COALESCE(m.starts_at, a.voted_at) <= ? AND COALESCE(m.starts_at, a.voted_at) >= date(?, '-2 years') ORDER BY decided_on DESC").bind(buildingId, `${transferDate}T23:59:59Z`, transferDate).all()).results as any[];
  const bank = await env.DB.prepare("SELECT iban FROM bank_accounts WHERE building_id = ? AND fund = 'working' LIMIT 1").bind(buildingId).first<{ iban: string }>();
  return {
    unit, sellers, transfer_date: transferDate, fiscal_year: fy, days_after: daysAfter, fy_days: fyDays,
    working_called: workingCalled, working_refund: round2(workingCalled * daysAfter / fyDays), reserve_paid: round2(reservePaidRow?.s ?? 0),
    arrears_working: arrearsW, arrears_reserve: arrearsR, fees: round2(fees), arrears_total: round2(arrearsW + arrearsR),
    pending_decisions: pending.map((p) => ({ title: p.title, decided_on: String(p.decided_on).slice(0, 10), decision: p.decision })), iban: bank?.iban ?? null,
  };
}
