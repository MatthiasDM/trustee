import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B, Client, as, uniq } from "./client";

/** Afrekening bij overdracht van een kavel (art. 3.94 §5 en 3.95 BW). */
describe("Verkoop van een kavel afrekenen", () => {
  let synd: Client, marie: Client;
  beforeAll(async () => { [synd, marie] = await Promise.all(["syndicus", "marie"].map(as)); });
  afterAll(async () => { await synd.put(`/api/buildings/${B}/units/un-g2/owners`, { owners: [{ user_id: "u-marie", share_pct: 100 }] }); });

  it("voorbeeld: werkkapitaal pro rata, reservekapitaal blijft, achterstallen apart; enkel de syndicus", async () => {
    expect((await marie.post(`/api/buildings/${B}/units/un-g2/transfer/preview`, { transfer_date: "2026-10-01" })).status).toBe(403);
    expect((await synd.post(`/api/buildings/${B}/units/un-g2/transfer/preview`, { transfer_date: "2031-01-01" })).data.error).toMatch(/Geen boekjaar/);
    const p = (await synd.post(`/api/buildings/${B}/units/un-g2/transfer/preview`, { transfer_date: "2026-10-01" })).data;
    expect(p.sellers.map((s: any) => s.name)).toEqual(["Marie Claes"]);
    expect(p.days_after).toBe(92); expect(p.fy_days).toBe(365);
    expect(p.working_called).toBeGreaterThanOrEqual(1000);
    expect(p.working_refund).toBeCloseTo(Math.round(p.working_called * 92 / 365 * 100) / 100, 2);
    expect(p.reserve_paid).toBeGreaterThanOrEqual(500);
    expect(p.arrears_total).toBeCloseTo(p.arrears_working + p.arrears_reserve, 2); // stand hangt af van eerdere bankverwerking in de testreeks
  });

  it("boeken: achterstal naar de verkoper, werkkapitaal opgevraagd bij de koper met OGM, koper wordt eigenaar, PDF bij de kavel", async () => {
    const before = (await synd.post(`/api/buildings/${B}/units/un-g2/transfer/preview`, { transfer_date: "2026-10-01" })).data;
    const mail = `${uniq("koper")}@t.be`;
    const r = await synd.post(`/api/buildings/${B}/units/un-g2/transfer`, { transfer_date: "2026-10-01", act_date: "2026-09-28", notary: "notaris Testmans", buyer_email: mail, buyer_name: "Kim Koper", working_refund: 300, due_date: "2026-10-31" });
    expect(r.status).toBe(201); expect(r.data.refund).toBe(300); expect(r.data.ogm).toMatch(/^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/); expect(r.data.arrears_total).toBe(before.arrears_total);
    expect(r.data.removed_sellers).toEqual([]); // Marie heeft nog kavel A2
    // de kavel heeft nu enkel nog het opgevraagde werkkapitaal van de koper open; de achterstal zit op de verkoper (416)
    const after = (await synd.post(`/api/buildings/${B}/units/un-g2/transfer/preview`, { transfer_date: "2026-10-01" }));
    expect(after.status).toBe(400); // geen eigenaar meer tot de koper de uitnodiging aanvaardt
    const entries = (await synd.get(`/api/buildings/${B}/ledger/entries`)).data as any[];
    expect(entries.some((e) => /achterstallen verkoper Marie Claes/.test(e.description))).toBe(true);
    expect(entries.some((e) => /Werkkapitaal bij overdracht kavel G2/.test(e.description))).toBe(true);
    // koper aanvaardt de uitnodiging en is eigenaar van G2, ziet het PDF en de oproep
    const koper = new Client(); expect((await koper.post("/api/auth/register", { name: "Kim Koper", email: mail, password: "wachtwoord123", inviteToken: r.data.invite_token, accept_terms: true })).status).toBe(200);
    const g2 = (await synd.get(`/api/buildings/${B}/units`)).data.units.find((u: any) => u.id === "un-g2"); expect(g2.owners.map((o: any) => o.name)).toEqual(["Kim Koper"]);
    const docs = (await koper.get(`/api/buildings/${B}/documents`)).data as any[]; expect(docs.some((d) => d.id === r.data.document_id)).toBe(true);
    expect((await marie.get(`/api/buildings/${B}/documents`)).data.some((d: any) => d.id === r.data.document_id)).toBe(false); // niet meer haar kavel
    const p2 = (await synd.post(`/api/buildings/${B}/units/un-g2/transfer/preview`, { transfer_date: "2026-10-01" })).data;
    expect(p2.arrears_working).toBeCloseTo(300, 2); // enkel het werkkapitaal van de koper staat open op de kavel
    const list = (await synd.get(`/api/buildings/${B}/transfers`)).data; expect(list[0].seller_names).toBe("Marie Claes"); expect(list[0].notary).toBe("notaris Testmans");
    expect((await synd.get(`/api/buildings/${B}/audit`)).data.some((a: any) => a.action === "unit.transfer")).toBe(true);
  });

  it("koper moet lid zijn of uitgenodigd worden; koper en verkoper verschillen", async () => {
    expect((await synd.post(`/api/buildings/${B}/units/un-a1/transfer`, { transfer_date: "2026-10-01" })).status).toBe(400);
    expect((await synd.post(`/api/buildings/${B}/units/un-a1/transfer`, { transfer_date: "2026-10-01", buyer_user_id: "u-jan" })).data.error).toMatch(/dezelfde persoon/);
  });
});
