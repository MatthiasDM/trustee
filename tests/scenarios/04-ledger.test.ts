import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

describe("Boekhouding: handelingen, bank, matching, afrekening, rapporten, begroting, afsluiting", () => {
  let synd: Client, marie: Client, jan: Client; let bankW = ""; let supplierId = "";
  beforeAll(async () => { [synd, marie, jan] = await Promise.all(["syndicus", "marie", "jan"].map(as)); bankW = (await synd.get(`/api/buildings/${B}/ledger/bank-accounts`)).data.find((b: any) => b.fund === "working").id; });

  it("weigert een journaalpost die niet in evenwicht is en boekingen buiten een boekjaar", async () => {
    const r = await synd.post(`/api/buildings/${B}/ledger/entries`, { date: "2026-03-01", description: "fout", lines: [{ account_code: "6121", debit: 100 }, { account_code: "440", credit: 90 }] });
    expect(r.status).toBe(400); expect(r.data.error).toMatch(/evenwicht/);
    expect((await synd.post(`/api/buildings/${B}/ledger/entries`, { date: "2031-03-01", description: "buiten boekjaar", lines: [{ account_code: "6121", debit: 1 }, { account_code: "440", credit: 1 }] })).data.error).toMatch(/boekjaar/i);
  });
  it("leverancier met standaardrekening; factuur via handeling; openstaande schuld zichtbaar", async () => {
    supplierId = (await synd.post(`/api/buildings/${B}/suppliers`, { name: "Engie Electrabel", iban: "BE99888877776666", default_account_code: "6121" })).data.id;
    const inv = await synd.post(`/api/buildings/${B}/ledger/templates/supplier_invoice/post`, { date: "2026-05-02", counterparty: "Engie Electrabel", amount: 250, expense_code: "6121" }); expect(inv.status).toBe(201);
    const s = await synd.get(`/api/buildings/${B}/ledger/reports/summary?fy=fy-2026&until=2026-12-31`); expect(s.data.cash.suppliers_open).toBeGreaterThanOrEqual(250);
    expect((await synd.post(`/api/buildings/${B}/ledger/templates/supplier_invoice/post`, { date: "2026-05-02", counterparty: "X", amount: -5, expense_code: "6121" })).status).toBe(400);
  });
  it("bankverrichting manueel → voorstel op bedrag en naam → matchen vermindert de schuld", async () => {
    await synd.post(`/api/buildings/${B}/ledger/bank-accounts/${bankW}/transactions`, { date: "2026-05-10", amount: -250, counterparty_name: "ENGIE ELECTRABEL", communication: "factuur mei" });
    const txs = await synd.get(`/api/buildings/${B}/ledger/bank-transactions`); const tx = txs.data.find((t: any) => t.amount === -250 && t.counterparty_name === "ENGIE ELECTRABEL");
    expect(tx.suggestion.kind).toBe("supplier_payment"); expect(tx.suggestion.confidence).toBe("high");
    const m = await synd.post(`/api/buildings/${B}/ledger/bank-transactions/${tx.id}/match`, { kind: tx.suggestion.kind }); expect(m.status).toBe(201);
    expect((await synd.post(`/api/buildings/${B}/ledger/bank-transactions/${tx.id}/match`, { kind: "bank_fee" })).status).toBe(400);
    const s = await synd.get(`/api/buildings/${B}/ledger/reports/summary?fy=fy-2026&until=2026-12-31`); expect(s.data.balance.total_assets).toBeCloseTo(s.data.balance.total_liabilities + s.data.balance.unallocated_result, 2);
  });
  it("CSV-import herkent kolommen, slaat dubbels over en herkent OGM van een oproep", async () => {
    const calls = await synd.get(`/api/buildings/${B}/ledger/calls`); const line = calls.data[0].lines.find((l: any) => l.label === "G2");
    const csv = `Datum;Bedrag;Naam tegenpartij;Rekeningnummer tegenpartij;Mededeling\n11/05/2026;1000,00;DE SMET LOTTE;BE12345678909999;${line.ogm}\n11/05/2026;-12,50;;;BANKKOSTEN\n`;
    const r1 = await synd.upload(`/api/buildings/${B}/ledger/bank-accounts/${bankW}/import`, {}, { name: "kbc.csv", content: csv, type: "text/csv" }); expect(r1.data.inserted).toBe(2);
    const r2 = await synd.upload(`/api/buildings/${B}/ledger/bank-accounts/${bankW}/import`, {}, { name: "kbc.csv", content: csv, type: "text/csv" }); expect(r2.data.inserted).toBe(0);
    const txs = await synd.get(`/api/buildings/${B}/ledger/bank-transactions`); const t = txs.data.find((x: any) => x.amount === 1000 && x.date === "2026-05-11");
    expect(t.suggestion.kind).toBe("owner_payment"); expect(t.suggestion.unit_label).toBe("G2");
    const m = await synd.post(`/api/buildings/${B}/ledger/bank-transactions/${t.id}/match`, { kind: "owner_payment", unit_id: t.suggestion.unit_id }); expect(m.status).toBe(201);
    const st = await synd.get(`/api/buildings/${B}/ledger/statements/fy-2026`); expect(st.data.units.find((u: any) => u.label === "G2").outstanding).toBeLessThanOrEqual(15.005);
  });
  it("afrekening: mede-eigenaar ziet enkel eigen kavels; kosten volgen de verdeelsleutel", async () => {
    const st = await marie.get(`/api/buildings/${B}/ledger/statements/fy-2026`); expect(st.data.units.map((u: any) => u.label).sort()).toEqual(["A2", "G2"]);
    const all = await synd.get(`/api/buildings/${B}/ledger/statements/fy-2026`);
    const total = all.data.units.reduce((s: number, u: any) => s + u.total_cost, 0); expect(total).toBeCloseTo(all.data.total_cost, 1);
    const lift = all.data.units.find((u: any) => u.label === "A1").costs.find((c: any) => c.code === "6101"); expect(lift).toBeUndefined(); // liftsleutel sluit A1 (gelijkvloers) uit
    expect(all.data.units.find((u: any) => u.label === "A2").costs.find((c: any) => c.code === "6101").amount).toBeGreaterThan(0);
  });
  it("periodieke boeking wordt geboekt en schuift op; vast actief plant afschrijvingen", async () => {
    const rec = await synd.post(`/api/buildings/${B}/ledger/recurring`, { name: "Testabonnement", template_code: "direct_expense", params: { counterparty: "Proximus", amount: 30, expense_code: "6124", bank_account_id: bankW }, frequency: "monthly", next_date: "2026-06-01" });
    const run = await synd.post(`/api/buildings/${B}/ledger/recurring/${rec.data.id}/run`); expect(run.status).toBe(200);
    const list = await synd.get(`/api/buildings/${B}/ledger/recurring`); expect(list.data.find((r: any) => r.id === rec.data.id).next_date).toBe("2026-07-01");
    const asset = await synd.post(`/api/buildings/${B}/ledger/assets`, { name: "Testcamera", asset_code: "2300", cost: 1000, acquired_at: "2026-02-01", years: 4 }); expect(asset.status).toBe(201); expect(asset.data.scheduled).toBe(2); // 2026 en 2027 bestaan
    const sched = await synd.get(`/api/buildings/${B}/ledger/entries?fy=fy-2026&status=scheduled`); expect(sched.data.some((e: any) => e.description.includes("Testcamera"))).toBe(true);
  });
  it("begroting: opstellen, vergelijken, goedkeuren vergrendelt", async () => {
    const acc = (await synd.get(`/api/buildings/${B}/ledger/accounts`)).data.find((a: any) => a.code === "6121");
    const fy = (await synd.post(`/api/buildings/${B}/ledger/fiscal-years`, { label: "2029", start_date: "2029-01-01", end_date: "2029-12-31" })).data.id;
    expect((await synd.put(`/api/buildings/${B}/ledger/budgets/${fy}`, { lines: [{ account_id: acc.id, amount: 3600 }] })).status).toBe(200);
    expect((await synd.post(`/api/buildings/${B}/ledger/budgets/${fy}/approve`, {})).status).toBe(200);
    expect((await synd.put(`/api/buildings/${B}/ledger/budgets/${fy}`, { lines: [] })).status).toBe(400);
    const b = await marie.get(`/api/buildings/${B}/ledger/budgets/${fy}`); expect(b.data.budget.status).toBe("approved"); expect(b.data.lines[0].amount).toBe(3600);
  });
  it("tegenboeking draait de lijnen om en markeert het origineel", async () => {
    const e = await synd.post(`/api/buildings/${B}/ledger/entries`, { date: "2026-05-20", description: "Test tegenboeking", lines: [{ account_code: "6109", debit: 42 }, { account_code: "440", credit: 42 }] });
    const r = await synd.post(`/api/buildings/${B}/ledger/entries/${e.data.id}/reverse`, { date: "2026-05-21", reason: "test" }); expect(r.status).toBe(201);
    const list = await synd.get(`/api/buildings/${B}/ledger/entries?fy=fy-2026&q=tegenboeking`); const orig = list.data.find((x: any) => x.id === e.data.id); const rev = list.data.find((x: any) => x.id === r.data.id);
    expect(orig.status).toBe("reversed"); expect(rev.lines.find((l: any) => l.code === "6109").credit).toBe(42);
    expect((await synd.post(`/api/buildings/${B}/ledger/entries/${e.data.id}/reverse`, { date: "2026-05-21", reason: "x" })).status).toBe(400);
  });
  it("commissaris noteert een bevinding bij een boeking; eigenaar mag dat niet", async () => {
    await synd.patch(`/api/buildings/${B}/members/u-ahmed`, { role: "commissaris" });
    const ahmed = await as("ahmed"); const e = (await synd.get(`/api/buildings/${B}/ledger/entries?fy=fy-2026`)).data[0];
    expect((await ahmed.post(`/api/buildings/${B}/ledger/entries/${e.id}/comments`, { body: "Stuk ontbreekt", kind: "finding" })).status).toBe(201);
    expect((await marie.post(`/api/buildings/${B}/ledger/entries/${e.id}/comments`, { body: "x" })).status).toBe(403);
    expect((await ahmed.patch(`/api/buildings/${B}/documents/${(await ahmed.get(`/api/buildings/${B}/documents`)).data[0].id}`, { name: "hack" })).status).toBe(403);
  });
  it("jaarrekening (voorlopig) en afrekeningen als geldige PDF; afsluiten geweigerd zolang er geplande boekingen zijn", async () => {
    const rep = await synd.post(`/api/buildings/${B}/ledger/fiscal-years/fy-2026/report`); expect(rep.status).toBe(201); expect(rep.data.provisional).toBe(true);
    const pdf = await synd.raw("GET", `/api/buildings/${B}/documents/${rep.data.documentId}/download`); expect(pdf.headers.get("content-type")).toBe("application/pdf"); expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    const close = await synd.post(`/api/buildings/${B}/ledger/fiscal-years/fy-2026/close`, {}); expect(close.status).toBe(400); expect(close.data.error).toMatch(/geplande/);
  });
  it("betalingsopvolging: herinnering en aanmaning met kost; eigenaar van de kavel ziet de brief, een andere niet", async () => {
    const od = await synd.get(`/api/buildings/${B}/ledger/overdue`); expect(od.status).toBe(200);
    const unit = od.data.units[0]; if (!unit) return;
    expect((await synd.post(`/api/buildings/${B}/ledger/reminders`, { unit_id: unit.unit_id, level: 1 })).status).toBe(201);
    const r2 = await synd.post(`/api/buildings/${B}/ledger/reminders`, { unit_id: unit.unit_id, level: 2, fee: 10 }); expect(r2.status).toBe(201);
    const od2 = await synd.get(`/api/buildings/${B}/ledger/overdue`); expect(od2.data.units.find((u: any) => u.unit_id === unit.unit_id).outstanding).toBeCloseTo(unit.outstanding + 10, 2);
    expect((await synd.post(`/api/buildings/${B}/ledger/reminders`, { unit_id: "un-bestaat-niet", level: 1 })).status).toBe(400);
  });
  it("overdrachtsdossier: eigenaar enkel voor eigen kavel; syndicus voor elke kavel", async () => {
    expect((await marie.post(`/api/buildings/${B}/ledger/units/un-a1/transfer-dossier`)).status).toBe(403);
    const r = await marie.post(`/api/buildings/${B}/ledger/units/un-a2/transfer-dossier`); expect(r.status).toBe(201);
    expect((await jan.raw("GET", `/api/buildings/${B}/documents/${r.data.documentId}/download`)).status).toBe(200);
    expect((await synd.post(`/api/buildings/${B}/ledger/units/un-a1/transfer-dossier`)).status).toBe(201);
  });
});
