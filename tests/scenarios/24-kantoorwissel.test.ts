import { describe, expect, it } from "vitest";
import { Client, as, uniq } from "./client";

/** Wissel van syndicuskantoor: code van het oude kantoor, overname door een beheerder van het nieuwe; gegevens en boekjaar gaan mee. */
describe("Overdracht naar een ander syndicuskantoor", () => {
  it("nieuw kantoor neemt over met code; oud kantoor verliest toegang; code is eenmalig", async () => {
    const synd = await as("syndicus"); const marie = await as("marie");
    const nb = (await synd.post("/api/buildings", { org_id: "org-demo", name: "Residentie Wissel", address: "Kaai 4", total_shares: 1000 })).data.id as string;
    await synd.post(`/api/buildings/${nb}/ledger/fiscal-years`, { label: "2026", start_date: "2026-01-01", end_date: "2026-12-31" });
    expect((await marie.post(`/api/buildings/${nb}/handover`)).status).toBe(403);
    const code = (await synd.post(`/api/buildings/${nb}/handover`)).data.code as string; expect(code).toMatch(/^[A-Z0-9]{6,10}$/);
    // nieuw kantoor: nieuwe syndicus registreert een kantoor
    const other = new Client(); const mail = `${uniq("kantoor")}@t.be`;
    expect((await other.post("/api/auth/register", { name: "Nieuwe Syndicus", email: mail, password: "wachtwoord123", orgName: "Kantoor Nieuw bv", accept_terms: true })).status).toBe(200);
    const orgId = (await other.get("/api/auth/me")).data.orgs[0].id;
    expect((await marie.post("/api/buildings/handover/accept", { code, org_id: orgId })).status).toBe(403); // geen beheerder van dat kantoor
    expect((await other.post("/api/buildings/handover/accept", { code: "FOUTCODE1", org_id: orgId })).status).toBe(400);
    const ok = await other.post("/api/buildings/handover/accept", { code, org_id: orgId }); expect(ok.status).toBe(200); expect(ok.data.building_id).toBe(nb);
    expect((await other.get(`/api/buildings/${nb}`)).data.org_name).toBe("Kantoor Nieuw bv");
    expect((await other.get(`/api/buildings/${nb}/ledger/fiscal-years`)).data.some((f: any) => f.label === "2026")).toBe(true); // boekjaar loopt door
    expect((await synd.get(`/api/buildings/${nb}`)).status).toBe(403); // oud kantoor heeft geen toegang meer
    expect((await other.post("/api/buildings/handover/accept", { code, org_id: orgId })).status).toBe(400); // eenmalig
  });
});
