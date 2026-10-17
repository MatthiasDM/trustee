import { describe, expect, it } from "vitest";
import { as } from "./client";

/** Structurele situaties: één eigenaar van alle kavels, kavels zonder aandelen, twee stemgerechtigden, voorlopig bewindvoerder (art. 3.92 §2). */
describe("Structurele situaties", () => {
  it("waarschuwt bij één eigenaar, kavels zonder aandelen en twee stemgerechtigden; bewindvoerder enkel via vonnis", async () => {
    const synd = await as("syndicus"); const marie = await as("marie");
    const nb = (await synd.post("/api/buildings", { org_id: "org-demo", name: "Residentie Duo", address: "Laan 3", total_shares: 1000 })).data.id as string;
    const [u1, u2, u3] = (await synd.post(`/api/buildings/${nb}/units`, [{ label: "D1", type: "appartement", shares: 600 }, { label: "D2", type: "appartement", shares: 400 }, { label: "K1", type: "berging", shares: 0 }])).data.ids;
    const warn = async () => (await synd.get(`/api/buildings/${nb}/organs`)).data.warnings.join(" ");
    for (const u of [u1, u2, u3]) await synd.put(`/api/buildings/${nb}/units/${u}/owners`, { owners: [{ user_id: "u-marie", share_pct: 100 }] });
    let w = await warn(); expect(w).toMatch(/één eigenaar.*3\.97/); expect(w).toMatch(/K1 heeft geen aandelen/);
    await synd.put(`/api/buildings/${nb}/units/${u2}/owners`, { owners: [{ user_id: "u-jan", share_pct: 100 }] });
    w = await warn(); expect(w).not.toMatch(/één eigenaar/); expect(w).toMatch(/maar twee stemgerechtigden/);
    const doc = (await synd.upload(`/api/buildings/${nb}/documents`, { category: "overig", visibility: "all" }, { name: "vonnis-bewind.pdf", content: "%PDF-1.4\n%%EOF", type: "application/pdf" })).data.id;
    const base = { organ: "voorlopig_bewindvoerder", user_id: "u-marie", start_date: "2026-01-01", end_date: "2027-06-30" };
    expect((await synd.post(`/api/buildings/${nb}/mandates`, { ...base, basis: "av", document_id: doc, scope: "Financieel herstel" })).data.error).toMatch(/rechter/);
    expect((await synd.post(`/api/buildings/${nb}/mandates`, { ...base, basis: "rechter", scope: "Financieel herstel" })).data.error).toMatch(/vonnis/);
    expect((await synd.post(`/api/buildings/${nb}/mandates`, { ...base, basis: "rechter", document_id: doc, scope: "Financieel herstel en invordering" })).status).toBe(201);
    const me = (await marie.get("/api/auth/me")).data.buildings.find((x: any) => x.id === nb); expect(me.role).toBe("syndicus");
    expect((await synd.get(`/api/buildings/${nb}/organs`)).data.syndicus.some((m: any) => /voorlopig bewindvoerder/.test(m.name))).toBe(true);
  });
});
