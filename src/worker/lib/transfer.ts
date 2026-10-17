import type { Env } from "../env";
import { Pdf, pdfOpts, dateNl, money } from "./pdf";
import { storeDocument } from "./reports";
import { round2 } from "./ledger";

/**
 * Overdrachtsdossier bij verkoop van een kavel (art. 3.94 §1 BW): de inlichtingen die de syndicus binnen 15 dagen
 * aan de notaris, de verkoper of de koper moet bezorgen vóór de ondertekening van de overeenkomst.
 */
export async function generateTransferDossier(env: Env, buildingId: string, userId: string | null, unitId: string): Promise<string> {
  const b = await env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(buildingId).first<any>();
  const u = await env.DB.prepare("SELECT un.*, (SELECT GROUP_CONCAT(us.name, ', ') FROM unit_owners uo JOIN users us ON us.id = uo.user_id WHERE uo.unit_id = un.id) AS owners FROM units un WHERE un.id = ? AND un.building_id = ?").bind(unitId, buildingId).first<any>();
  if (!u) throw new Error("Kavel niet gevonden");
  const sumBank = async (fund: string) => round2((await env.DB.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS s FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.status = 'posted' AND a.class = 5 AND a.fund = ?").bind(buildingId, fund).first<any>())?.s ?? 0);
  const working = await sumBank("working"), reserve = await sumBank("reserve");
  const shareFrac = b.total_shares ? u.shares / b.total_shares : 0;
  const unitOpen = (await env.DB.prepare("SELECT a.fund, COALESCE(SUM(jl.debit - jl.credit),0) AS open FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE jl.unit_id = ? AND je.status = 'posted' AND a.code IN ('4100','4101') GROUP BY a.fund").bind(unitId).all()).results as any[];
  const openW = round2(unitOpen.find((x) => x.fund === "working")?.open ?? 0), openR = round2(unitOpen.find((x) => x.fund === "reserve")?.open ?? 0);
  const reminders = (await env.DB.prepare("SELECT level, fee, sent_at FROM payment_reminders WHERE unit_id = ? ORDER BY sent_at DESC").bind(unitId).all()).results as any[];
  const fees = round2(reminders.reduce((s, r) => s + r.fee, 0));
  const calls = (await env.DB.prepare("SELECT cc.date, cc.due_date, cc.fund, cc.description, ccl.amount FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id WHERE ccl.unit_id = ? AND cc.building_id = ? ORDER BY cc.date DESC LIMIT 12").bind(unitId, buildingId).all()).results as any[];
  const threeYears = new Date(); threeYears.setFullYear(threeYears.getFullYear() - 3);
  const meetings = (await env.DB.prepare("SELECT m.title, m.starts_at, m.type, m.minutes_status, d.name AS minutes_name FROM meetings m LEFT JOIN documents d ON d.id = m.minutes_document_id WHERE m.building_id = ? AND m.type IN ('av','bav') AND m.starts_at >= ? AND m.starts_at <= ? ORDER BY m.starts_at DESC").bind(buildingId, threeYears.toISOString(), new Date().toISOString()).all()).results as any[];
  const fys = (await env.DB.prepare("SELECT fy.label, fy.status, fy.end_date, d.name AS report_name FROM fiscal_years fy LEFT JOIN documents d ON d.id = fy.report_document_id WHERE fy.building_id = ? ORDER BY fy.end_date DESC LIMIT 3").bind(buildingId).all()).results as any[];
  const lastClosed = fys.find((f) => f.status === "closed");
  const statements = (await env.DB.prepare("SELECT d.name, d.created_at FROM documents d WHERE d.unit_id = ? AND d.name LIKE 'Afrekening%' ORDER BY d.created_at DESC LIMIT 2").bind(unitId).all()).results as any[];
  const today = new Date().toISOString().slice(0, 10);
  const organs = (await env.DB.prepare("SELECT m.organ, COALESCE(u.name, m.holder_name) AS name, m.end_date FROM mandates m LEFT JOIN users u ON u.id = m.user_id WHERE m.building_id = ? AND m.start_date <= ? AND m.end_date >= ? ORDER BY m.organ").bind(buildingId, today, today).all()).results as any[];
  const budget = await env.DB.prepare("SELECT bu.status, fy.label, (SELECT COALESCE(SUM(amount),0) FROM budget_lines bl WHERE bl.budget_id = bu.id AND bl.kind='extraordinary') AS extraordinary FROM budgets bu JOIN fiscal_years fy ON fy.id = bu.fiscal_year_id WHERE bu.building_id = ? ORDER BY fy.end_date DESC LIMIT 1").bind(buildingId).first<any>();
  const decided = (await env.DB.prepare("SELECT a.title, a.decision, m.starts_at FROM agenda_items a JOIN meetings m ON m.id = a.meeting_id WHERE a.building_id = ? AND a.status = 'decided' AND (a.required_majority IN ('two_thirds','four_fifths') OR a.title LIKE '%werk%' OR a.title LIKE '%renovatie%') ORDER BY m.starts_at DESC LIMIT 8").bind(buildingId).all()).results as any[];

  const pdf = await Pdf.create(`${b.name} - Overdrachtsdossier kavel ${u.label}`, pdfOpts(b));
  pdf.title(`Inlichtingen bij overdracht van kavel ${u.label} (art. 3.94 §1 BW)`);
  pdf.text(`Vereniging van mede-eigenaars ${b.name}, ${b.address}${b.city ? `, ${b.postal_code ?? ""} ${b.city}` : ""}${b.enterprise_number ? ` - KBO ${b.enterprise_number}` : ""}. Opgemaakt op ${dateNl(new Date().toISOString())} door de syndicus, op verzoek met het oog op de overdracht.`);
  pdf.text(`Kavel ${u.label} (${u.type}${u.floor ? `, verdieping ${u.floor}` : ""}), ${u.shares} aandelen op ${b.total_shares} (${(shareFrac * 100).toFixed(2)} %). Huidige eigenaar(s): ${u.owners ?? "-"}.`);
  pdf.h2("1. Werkkapitaal en reservekapitaal");
  pdf.table([{ label: "Post", w: 0.55 }, { label: "VME", w: 0.22, align: "right" }, { label: "Aandeel kavel", w: 0.23, align: "right" }], [["Werkkapitaal (saldo rekeningen)", money(working), money(working * shareFrac)], ["Reservekapitaal (saldo rekeningen)", money(reserve), money(reserve * shareFrac)], ["Nog te innen voorschotten werkkapitaal (alle kavels)", money((await env.DB.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS s FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = ? AND je.status='posted' AND a.code='4101'").bind(buildingId).first<any>())?.s ?? 0), "-"]]);
  pdf.text("Het aandeel van de verkoper in het reservekapitaal blijft eigendom van de vereniging en gaat over op de koper (art. 3.94 §3); de verkoper kan het niet terugvorderen. Het werkkapitaal wordt in de afrekening tussen partijen verrekend.", 8.5, { color: [0.35, 0.35, 0.35] });
  pdf.h2("2. Achterstallen van de verkoper op deze kavel");
  pdf.table([{ label: "Post", w: 0.7 }, { label: "Bedrag", w: 0.3, align: "right" }], [["Openstaande voorschotten werkkapitaal", money(openW)], ["Openstaande voorschotten reservekapitaal", money(openR)], ["Aangerekende aanmaningskosten (inbegrepen)", money(fees)], ["Totaal verschuldigd door de verkoper", money(openW + openR)]], { totalRow: true });
  if (reminders.length) pdf.text(`Verzonden herinneringen: ${reminders.map((r) => `${["", "herinnering", "aanmaning", "ingebrekestelling"][r.level]} op ${dateNl(r.sent_at)}`).join("; ")}.`, 8.5);
  pdf.h2("3. Opgevraagde en toekomstige bijdragen");
  pdf.table([{ label: "Datum", w: 0.15 }, { label: "Omschrijving", w: 0.5 }, { label: "Fonds", w: 0.15 }, { label: "Bedrag", w: 0.2, align: "right" }], calls.length ? calls.map((c) => [dateNl(c.date), c.description, c.fund === "reserve" ? "reserve" : "werk", money(c.amount)]) : [["-", "Geen oproepen geregistreerd", "", ""]]);
  if (budget) pdf.text(`Begroting ${budget.label} (${budget.status === "approved" ? "goedgekeurd door de AV" : "ontwerp"}): buitengewone kosten en werken voorzien voor ${money(budget.extraordinary)} voor de hele vereniging; aandeel van de kavel ${money(budget.extraordinary * shareFrac)}.`);
  pdf.h2("4. Beslissingen van de AV over werken en lopende procedures");
  if (decided.length) pdf.table([{ label: "AV", w: 0.15 }, { label: "Agendapunt", w: 0.4 }, { label: "Beslissing", w: 0.45 }], decided.map((d) => [dateNl(d.starts_at), d.title, d.decision ?? ""]), { size: 8 }); else pdf.text("Geen geregistreerde beslissingen over buitengewone werken.");
  pdf.text(`Lopende gerechtelijke procedures: ${b.legal_proceedings || "geen, volgens opgave van de syndicus."}`);
  if (b.insurance_info) pdf.text(`Verzekeringen: ${b.insurance_info}`);
  pdf.h2("5. Notulen van de laatste drie jaar en rekeningen van de laatste twee jaar");
  pdf.table([{ label: "Datum", w: 0.18 }, { label: "Algemene vergadering", w: 0.52 }, { label: "Notulen", w: 0.3 }], meetings.length ? meetings.map((m) => [dateNl(m.starts_at), m.title, m.minutes_status === "final" ? m.minutes_name ?? "beschikbaar" : "niet beschikbaar"]) : [["-", "Geen vergaderingen in de periode", ""]], { size: 8 });
  pdf.table([{ label: "Boekjaar", w: 0.2 }, { label: "Status", w: 0.3 }, { label: "Jaarrekening", w: 0.5 }], fys.map((f) => [f.label, f.status === "closed" ? "afgesloten" : "lopend", f.report_name ?? "-"]), { size: 8 });
  pdf.text(`Laatste goedgekeurde balans: ${lastClosed ? `boekjaar ${lastClosed.label} (${lastClosed.report_name ?? "zie Documenten"})` : "nog geen afgesloten boekjaar"}. Periodieke afrekeningen van deze kavel: ${statements.length ? statements.map((s) => s.name).join(", ") : "nog geen"}.`, 8.5);
  pdf.h2("6. Organen van de vereniging");
  pdf.table([{ label: "Orgaan", w: 0.4 }, { label: "Titularis", w: 0.4 }, { label: "Mandaat tot", w: 0.2 }], organs.length ? organs.map((o) => [{ syndicus: "Syndicus", raad: "Raad van mede-eigendom", commissaris: "Commissaris van de rekeningen" }[o.organ as string] ?? o.organ, o.name, dateNl(o.end_date)]) : [["-", "Geen mandaten geregistreerd", ""]]);
  pdf.space(8);
  pdf.text("De documenten zelf (statuten, reglement van interne orde, notulen, jaarrekeningen, afrekeningen) zijn beschikbaar via het platform of op verzoek bij de syndicus. Na de overdracht bezorgt de syndicus op verzoek van de notaris binnen 30 dagen de staat van de schulden van de verkoper (art. 3.94 §2).", 8.5, { color: [0.35, 0.35, 0.35] });
  return storeDocument(env, buildingId, userId, { name: `Overdrachtsdossier kavel ${u.label} ${today}.pdf`, bytes: await pdf.bytes(), mime: "application/pdf", category: "overdracht", description: `Inlichtingen art. 3.94 §1 BW voor de verkoop van kavel ${u.label}.`, folderMatch: /boekhouding/i, unitId, visibility: "owners_only" });
}
