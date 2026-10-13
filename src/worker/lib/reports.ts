import type { Env } from "../env";
import { Pdf, dateNl, money } from "./pdf";
import { uid } from "./util";
import { ownerStatement, summary } from "../routes/ledger";
import { ogm } from "./ledger";

/** Bewaart gegenereerde bytes als document in Documenten (map op naam, optioneel gekoppeld aan één kavel). */
export async function storeDocument(env: Env, buildingId: string, userId: string | null, opts: { name: string; bytes: Uint8Array | string; mime: string; category: string; description?: string; folderMatch?: RegExp; unitId?: string | null; visibility?: string }) {
  const id = uid();
  const folder = opts.folderMatch ? await env.DB.prepare("SELECT id, name FROM folders WHERE building_id = ? ORDER BY name").bind(buildingId).all().then((r) => (r.results as any[]).find((f) => opts.folderMatch!.test(f.name))) : null;
  const key = `${buildingId}/${id}/${opts.name.replace(/[^\w.\-() ]+/g, "_")}`;
  await env.DOCS.put(key, opts.bytes, { httpMetadata: { contentType: opts.mime } });
  const size = typeof opts.bytes === "string" ? opts.bytes.length : opts.bytes.byteLength;
  await env.DB.prepare("INSERT INTO documents (id, building_id, folder_id, name, description, category, r2_key, size, mime, visibility, uploaded_by, unit_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, buildingId, folder?.id ?? null, opts.name, opts.description ?? null, opts.category, key, size, opts.mime, opts.visibility ?? "all", userId, opts.unitId ?? null).run();
  return id;
}

async function buildingRow(env: Env, buildingId: string) { return (await env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(buildingId).first<any>())!; }

/** Jaarrekening: balans, resultatenrekening, kas en kapitaal, begroting vs werkelijkheid, afrekening per kavel. */
export async function generateAnnualReport(env: Env, buildingId: string, userId: string | null, fyId: string, provisional: boolean): Promise<string> {
  const b = await buildingRow(env, buildingId);
  const fy = await env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(fyId, buildingId).first<any>();
  const s = await summary(env, buildingId, fyId, fy.end_date);
  const st = await ownerStatement(env, buildingId, fyId, null);
  const budget = await env.DB.prepare("SELECT * FROM budgets WHERE building_id = ? AND fiscal_year_id = ?").bind(buildingId, fyId).first<any>();
  const blines = budget ? (await env.DB.prepare("SELECT bl.*, a.code, a.name FROM budget_lines bl JOIN accounts a ON a.id = bl.account_id WHERE bl.budget_id = ? ORDER BY a.code").bind(budget.id).all()).results as any[] : [];
  const pdf = await Pdf.create(`${b.name} - Jaarrekening ${fy.label}${provisional ? " (voorlopig)" : ""}`);
  pdf.title(`Jaarrekening boekjaar ${fy.label}${provisional ? " (voorlopige versie)" : ""}`);
  pdf.text(`Vereniging van mede-eigenaars ${b.name}, ${b.address}${b.city ? `, ${b.postal_code ?? ""} ${b.city}` : ""}${b.enterprise_number ? ` - KBO ${b.enterprise_number}` : ""}`);
  pdf.text(`Boekjaar van ${dateNl(fy.start_date)} tot ${dateNl(fy.end_date)}. Opgemaakt op ${dateNl(new Date().toISOString())} volgens het minimum genormaliseerd rekeningenstelsel (KB 12 juli 2012).`);
  pdf.h2("1. Resultatenrekening");
  pdf.table([{ label: "Rekening", w: 0.15 }, { label: "Kosten", w: 0.6 }, { label: "Bedrag", w: 0.25, align: "right" }], [...s.result.expenses.map((r: any) => [r.code, `${r.name}${r.memo ? ` (${r.memo})` : ""}`, money(r.amount)]), ["", "Totaal kosten", money(s.result.total_expenses)]], { totalRow: true });
  pdf.table([{ label: "Rekening", w: 0.15 }, { label: "Opbrengsten en voorschotten", w: 0.6 }, { label: "Bedrag", w: 0.25, align: "right" }], [...s.result.income.map((r: any) => [r.code, r.name, money(r.amount)]), ["", "Totaal opbrengsten", money(s.result.total_income)]], { totalRow: true });
  pdf.text(`Resultaat van het boekjaar: ${money(s.result.result)} (${s.result.result >= 0 ? "overschot, over te dragen naar werk- en reservekapitaal" : "tekort, bij te passen door de mede-eigenaars"}).`, 10, { bold: true });
  pdf.h2(`2. Balans op ${dateNl(fy.end_date)}`);
  pdf.table([{ label: "Actief", w: 0.55 }, { label: "Bedrag", w: 0.45, align: "right" }], [...s.balance.assets.map((r: any) => [`${r.code} ${r.name}`, money(r.amount)]), ["Totaal actief", money(s.balance.total_assets)]], { totalRow: true });
  pdf.table([{ label: "Passief", w: 0.55 }, { label: "Bedrag", w: 0.45, align: "right" }], [...s.balance.liabilities.map((r: any) => [`${r.code} ${r.name}`, money(r.amount)]), ...(s.balance.unallocated_result !== 0 ? [["Resultaat van het boekjaar (nog over te dragen)", money(s.balance.unallocated_result)]] : []), ["Totaal passief", money(s.balance.total_liabilities + s.balance.unallocated_result)]], { totalRow: true });
  pdf.h2("3. Kas- en kapitaalpositie");
  pdf.table([{ label: "Post", w: 0.6 }, { label: "Bedrag", w: 0.4, align: "right" }], [["Werkkapitaal op bank (551)", money(s.cash.working_bank)], ["Reservekapitaal op bank en deposito's (550, 53x)", money(s.cash.reserve_bank + s.cash.deposits)], ["Andere rekeningen en kas", money(s.cash.other_bank)], ["Nog te ontvangen voorschotten van mede-eigenaars", money(s.cash.open_receivables)], ["Openstaande leveranciersfacturen", money(s.cash.suppliers_open)], ["Overgedragen reservekapitaal (48901)", money(s.cash.reserve_carried)], ["Overgedragen werkkapitaal (48902)", money(s.cash.working_carried)]]);
  if (blines.length) {
    pdf.h2(`4. Begroting ${fy.label} tegenover werkelijkheid${budget.status === "approved" ? " (begroting goedgekeurd door de AV)" : ""}`);
    const actual = (code: string) => s.result.expenses.filter((r: any) => r.code === code).reduce((x: number, r: any) => x + r.amount, 0);
    pdf.table([{ label: "Rekening", w: 0.15 }, { label: "Rubriek", w: 0.4 }, { label: "Begroot", w: 0.15, align: "right" }, { label: "Werkelijk", w: 0.15, align: "right" }, { label: "Verschil", w: 0.15, align: "right" }], [...blines.map((l) => [l.code, `${l.name}${l.kind === "extraordinary" ? " (buitengewoon)" : ""}`, money(l.amount), money(actual(l.code)), money(l.amount - actual(l.code))]), ["", "Totaal", money(blines.reduce((x, l) => x + l.amount, 0)), money(blines.reduce((x, l) => x + actual(l.code), 0)), money(blines.reduce((x, l) => x + l.amount - actual(l.code), 0))]], { totalRow: true });
  }
  pdf.h2(`${blines.length ? 5 : 4}. Afrekening per kavel`);
  pdf.text("Aandeel in de kosten volgens de verdeelsleutels per boeking, tegenover de opgeroepen en betaalde voorschotten. Een positief resultaat is te veel betaald voorschot (overgedragen of terug te betalen), een negatief resultaat is bij te passen.");
  pdf.table([{ label: "Kavel", w: 0.1 }, { label: "Eigenaar(s)", w: 0.3 }, { label: "Aand.", w: 0.08, align: "right" }, { label: "Kosten", w: 0.13, align: "right" }, { label: "Opgeroepen werk", w: 0.13, align: "right" }, { label: "Betaald", w: 0.13, align: "right" }, { label: "Resultaat", w: 0.13, align: "right" }],
    [...st.units.map((u: any) => [u.label, u.owners ?? "-", String(u.shares), money(u.total_cost), money(u.working.called), money(u.working.paid + u.reserve.paid), money(u.result)]), ["", "Totaal", String(st.units.reduce((x: number, u: any) => x + u.shares, 0)), money(st.total_cost), money(st.units.reduce((x: number, u: any) => x + u.working.called, 0)), money(st.units.reduce((x: number, u: any) => x + u.working.paid + u.reserve.paid, 0)), money(st.units.reduce((x: number, u: any) => x + u.result, 0))]], { totalRow: true, size: 8 });
  pdf.space(10);
  pdf.text("Deze jaarrekening wordt ter goedkeuring voorgelegd aan de algemene vergadering, samen met het verslag van de commissaris van de rekeningen en de vraag tot kwijting van de syndicus (art. 3.89 BW).", 8.5, { color: [0.35, 0.35, 0.35] });
  const bytes = await pdf.bytes();
  const docId = await storeDocument(env, buildingId, userId, { name: `Jaarrekening ${fy.label}${provisional ? " (voorlopig)" : ""}.pdf`, bytes, mime: "application/pdf", category: "boekhouding", description: `${provisional ? "Voorlopige j" : "J"}aarrekening boekjaar ${fy.label}: balans, resultatenrekening, kas en kapitaal, afrekening per kavel.`, folderMatch: /boekhouding/i });
  if (!provisional) await env.DB.prepare("UPDATE fiscal_years SET report_document_id = ? WHERE id = ?").bind(docId, fyId).run();
  return docId;
}

/** Individuele afrekening per kavel als PDF, enkel zichtbaar voor de eigenaars van die kavel en de organen. */
export async function generateOwnerStatements(env: Env, buildingId: string, userId: string | null, fyId: string): Promise<{ unit_id: string; label: string; document_id: string; owner_ids: string[]; outstanding: number }[]> {
  const b = await buildingRow(env, buildingId);
  const fy = await env.DB.prepare("SELECT * FROM fiscal_years WHERE id = ? AND building_id = ?").bind(fyId, buildingId).first<any>();
  const st = await ownerStatement(env, buildingId, fyId, null);
  const bank = await env.DB.prepare("SELECT iban, name FROM bank_accounts WHERE building_id = ? AND fund = 'working' LIMIT 1").bind(buildingId).first<any>();
  const out = [];
  for (const u of st.units) {
    const owners = (await env.DB.prepare("SELECT user_id FROM unit_owners WHERE unit_id = ?").bind(u.unit_id).all()).results.map((r: any) => r.user_id as string);
    if (!owners.length) continue;
    const openLine = await env.DB.prepare("SELECT ccl.ogm FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id WHERE ccl.unit_id = ? AND cc.building_id = ? ORDER BY cc.date DESC LIMIT 1").bind(u.unit_id, buildingId).first<any>();
    const pdf = await Pdf.create(`${b.name} - Afrekening ${fy.label} kavel ${u.label}`);
    pdf.title(`Afrekening boekjaar ${fy.label} - kavel ${u.label}`);
    pdf.text(`Vereniging van mede-eigenaars ${b.name}, ${b.address}${b.city ? `, ${b.postal_code ?? ""} ${b.city}` : ""}`);
    pdf.text(`Eigenaar(s): ${u.owners}. Kavel ${u.label}, ${u.shares} aandelen op ${b.total_shares}. Periode ${dateNl(fy.start_date)} - ${dateNl(fy.end_date)}.`);
    pdf.h2("1. Uw aandeel in de gemeenschappelijke kosten");
    pdf.table([{ label: "Rekening", w: 0.15 }, { label: "Kostenrubriek", w: 0.6 }, { label: "Uw aandeel", w: 0.25, align: "right" }], [...u.costs.map((c: any) => [c.code, c.name, money(c.amount)]), ["", "Totaal kosten", money(u.total_cost)]], { totalRow: true });
    pdf.h2("2. Voorschotten");
    pdf.table([{ label: "Post", w: 0.6 }, { label: "Bedrag", w: 0.4, align: "right" }], [["Opgeroepen werkkapitaal", money(u.working.called)], ["Betaald werkkapitaal", money(u.working.paid)], ["Opgeroepen reservekapitaal", money(u.reserve.called)], ["Betaald reservekapitaal", money(u.reserve.paid)], ...(u.opening_balance ? [["Openstaand saldo vorige boekjaren", money(u.opening_balance)]] : [])]);
    pdf.h2("3. Saldo");
    pdf.table([{ label: "Post", w: 0.6 }, { label: "Bedrag", w: 0.4, align: "right" }], [["Resultaat werkkapitaal (opgeroepen - kosten)", money(u.result)], ["Nog te betalen voorschotten", money(u.outstanding)]], { totalRow: true });
    if (u.outstanding > 0) pdf.text(`Gelieve ${money(u.outstanding)} te betalen op ${bank?.iban ?? "de rekening van de VME"}${bank?.name ? ` (${bank.name})` : ""}${openLine ? ` met gestructureerde mededeling ${openLine.ogm}` : ""}.`, 10, { bold: true });
    else if (u.result > 0) pdf.text(`U betaalde ${money(u.result)} meer voorschot dan uw aandeel in de kosten. Dit bedrag blijft, tenzij de algemene vergadering anders beslist, als werkkapitaal van de vereniging op uw naam staan.`, 9.5);
    else if (u.result < 0) pdf.text(`Uw aandeel in de kosten overschrijdt de voorschotten met ${money(-u.result)}. De algemene vergadering beslist over de aanzuivering.`, 9.5);
    pdf.space(8);
    pdf.text("Deze afrekening steunt op de boekhouding van de vereniging, gecontroleerd door de commissaris van de rekeningen en goed te keuren door de algemene vergadering. U hebt inzagerecht in alle onderliggende stukken (art. 3.89 par. 5, 9 BW).", 8.5, { color: [0.35, 0.35, 0.35] });
    const docId = await storeDocument(env, buildingId, userId, { name: `Afrekening ${fy.label} kavel ${u.label}.pdf`, bytes: await pdf.bytes(), mime: "application/pdf", category: "boekhouding", description: `Individuele afrekening boekjaar ${fy.label} voor kavel ${u.label}.`, folderMatch: /boekhouding/i, unitId: u.unit_id, visibility: "owners_only" });
    out.push({ unit_id: u.unit_id, label: u.label, document_id: docId, owner_ids: owners, outstanding: u.outstanding });
  }
  return out;
}

/** Verslag van de commissaris van de rekeningen als PDF. */
export async function renderCommissionerReport(env: Env, buildingId: string, report: any, authorName: string, fyLabel: string) {
  const b = await buildingRow(env, buildingId);
  const concl: Record<string, string> = { approve: "De commissaris adviseert de algemene vergadering de rekeningen goed te keuren en de syndicus kwijting te verlenen.", approve_with_remarks: "De commissaris adviseert de rekeningen goed te keuren en kwijting te verlenen, mits rekening wordt gehouden met de opmerkingen hieronder.", reject: "De commissaris kan de rekeningen in hun huidige vorm niet goedkeuren en adviseert de algemene vergadering de kwijting uit te stellen." };
  const pdf = await Pdf.create(`${b.name} - Verslag commissaris ${fyLabel}`);
  pdf.title(`Verslag van de commissaris van de rekeningen - boekjaar ${fyLabel}`);
  pdf.text(`Vereniging van mede-eigenaars ${b.name}. Commissaris: ${authorName}. Gecontroleerde periode: ${dateNl(report.period_from)} tot ${dateNl(report.period_to)}. Opgemaakt op ${dateNl(new Date().toISOString())}.`);
  pdf.h2("1. Opdracht en omvang van de controle"); pdf.text(report.scope || "Controle van de boekhouding, de verantwoordingsstukken, de bankuittreksels, de oproepen van voorschotten en de afrekening per kavel, overeenkomstig art. 3.91 BW en het reglement van interne orde.");
  pdf.h2("2. Vaststellingen"); pdf.text(report.findings || "Geen bijzondere vaststellingen.");
  pdf.h2("3. Besluit en advies aan de algemene vergadering"); pdf.text(concl[report.conclusion] ?? report.conclusion, 10, { bold: true }); if (report.recommendation) pdf.text(report.recommendation);
  pdf.space(8); pdf.text("De commissaris controleert de rekeningen en rapporteert; de boekhouding wordt gevoerd door de syndicus, die als enige aansprakelijk is voor zijn beheer (art. 3.89 par. 6 BW).", 8.5, { color: [0.35, 0.35, 0.35] });
  return pdf.bytes();
}

/** Openstaande voorschotten per kavel met vervallen oproepen en laatste herinnering. */
export async function overdueUnits(env: Env, buildingId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const units = (await env.DB.prepare(`SELECT un.id AS unit_id, un.label,
      (SELECT GROUP_CONCAT(u.name, ', ') FROM unit_owners uo JOIN users u ON u.id = uo.user_id WHERE uo.unit_id = un.id) AS owners,
      (SELECT COALESCE(SUM(jl.debit - jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE jl.unit_id = un.id AND je.status = 'posted' AND a.code IN ('4100','4101')) AS outstanding,
      (SELECT MIN(cc.due_date) FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id WHERE ccl.unit_id = un.id AND cc.due_date IS NOT NULL AND cc.due_date < ?) AS oldest_due,
      (SELECT MAX(level) FROM payment_reminders pr WHERE pr.unit_id = un.id AND pr.sent_at > COALESCE((SELECT MAX(je.date) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE jl.unit_id = un.id AND a.code IN ('4100','4101') AND jl.credit > 0 AND je.status='posted'), '')) AS last_level,
      (SELECT MAX(sent_at) FROM payment_reminders pr WHERE pr.unit_id = un.id) AS last_sent
     FROM units un WHERE un.building_id = ? ORDER BY un.label`).bind(today, buildingId).all()).results as any[];
  return units.filter((u) => u.outstanding > 0.004).map((u) => ({ ...u, outstanding: Math.round(u.outstanding * 100) / 100, days_overdue: u.oldest_due ? Math.floor((Date.now() - new Date(u.oldest_due).getTime()) / 86400_000) : 0 }));
}
export { ogm };
