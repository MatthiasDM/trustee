import { describe, expect, it } from "vitest";
import { Client, PW, uniq } from "./client";

describe("Onboarding: syndicuskantoor, gebouw, kavels, uitnodigingen", () => {
  const synd = new Client("synd"); const owner = new Client("owner"); const tenant = new Client("tenant");
  const email = `${uniq("synd")}@test.be`; const ownerMail = `${uniq("owner")}@test.be`; const tenantMail = `${uniq("tenant")}@test.be`;
  let buildingId = ""; let unitId = "";

  it("registreert een syndicus met eigen organisatie", async () => {
    const r = await synd.post("/api/auth/register", { name: "Test Syndicus", email, password: PW, orgName: "Testkantoor bv" });
    expect(r.status).toBe(200);
    const me = await synd.get("/api/auth/me"); expect(me.data.user.email).toBe(email); expect(me.data.orgs).toHaveLength(1); expect(me.data.orgs[0].role).toBe("owner");
  });
  it("weigert een dubbele registratie en een te kort wachtwoord", async () => {
    expect((await new Client().post("/api/auth/register", { name: "Xy", email, password: PW })).status).toBe(409);
    expect((await new Client().post("/api/auth/register", { name: "X", email: uniq("y") + "@t.be", password: "kort" })).status).toBe(400);
  });
  it("maakt een gebouw met standaardmappen en wordt er syndicus van", async () => {
    const me = await synd.get("/api/auth/me");
    const r = await synd.post("/api/buildings", { org_id: me.data.orgs[0].id, name: "Residentie Test", address: "Teststraat 1", city: "Gent", postal_code: "9000", total_shares: 1000 });
    expect(r.status).toBe(201); buildingId = r.data.id;
    const b = await synd.get(`/api/buildings/${buildingId}`); expect(b.data.role).toBe("syndicus");
    const folders = await synd.get(`/api/buildings/${buildingId}/folders`); expect(folders.data.length).toBeGreaterThanOrEqual(7);
    const ledger = await synd.get(`/api/buildings/${buildingId}/ledger/accounts`); expect(ledger.data.length).toBeGreaterThan(100);
  });
  it("voegt kavels toe en bewaakt de som van de aandelen", async () => {
    const r = await synd.post(`/api/buildings/${buildingId}/units`, [{ label: "1A", type: "appartement", floor: "1", shares: 400 }, { label: "1B", type: "appartement", floor: "1", shares: 400 }, { label: "G1", type: "garage", shares: 200 }]);
    expect(r.status).toBe(201); unitId = r.data.ids[0];
    const u = await synd.get(`/api/buildings/${buildingId}/units`); expect(u.data.sum_shares).toBe(1000); expect(u.data.total_shares).toBe(1000);
  });
  it("nodigt een eigenaar en een huurder uit; de eigenaar wordt gekoppeld aan zijn kavel", async () => {
    const r = await synd.post(`/api/buildings/${buildingId}/invites`, { invites: [{ email: ownerMail, name: "Nieuwe Eigenaar", role: "eigenaar", unit_id: unitId }, { email: tenantMail, role: "huurder" }] });
    expect(r.status).toBe(200); expect(r.data.created).toBe(2); expect(r.data.tokens).toHaveLength(2);
    const tok = r.data.tokens.find((t: any) => t.email === ownerMail).token;
    const info = await new Client().get(`/api/auth/invite/${tok}`); expect(info.data.building_name).toBe("Residentie Test"); expect(info.data.unit_label).toBe("1A"); expect(info.data.has_account).toBe(false);
    const reg = await owner.post("/api/auth/register", { name: "Nieuwe Eigenaar", email: ownerMail, password: PW, inviteToken: tok }); expect(reg.status).toBe(200);
    const me = await owner.get("/api/auth/me"); expect(me.data.buildings[0].role).toBe("eigenaar");
    const units = await owner.get(`/api/buildings/${buildingId}/units`); expect(units.data.units.find((u: any) => u.id === unitId).owners[0].email).toBe(ownerMail);
    // huurder via token met verkeerd e-mailadres wordt geweigerd
    const tok2 = r.data.tokens.find((t: any) => t.email === tenantMail).token;
    const wrong = await new Client().post("/api/auth/register", { name: "Iemand", email: uniq("ander") + "@t.be", password: PW, inviteToken: tok2 }); expect(wrong.status).toBe(403);
    expect((await tenant.post("/api/auth/register", { name: "Huurder", email: tenantMail, password: PW, inviteToken: tok2 })).status).toBe(200);
    expect((await new Client().get(`/api/auth/invite/${tok2}`)).data.accepted_at).toBeTruthy();
  });
  it("laat de eigenaar zijn gebouw zien en de huurder niet stemmen", async () => {
    const d = await owner.get(`/api/buildings/${buildingId}`); expect(d.status).toBe(200); expect(d.data.stats.members).toBe(3);
    const agenda = await tenant.post(`/api/buildings/${buildingId}/agenda`, { title: "Test" }); expect(agenda.status).toBe(403);
  });
  it("laat een gebruiker zijn gegevens exporteren en zijn account verwijderen, behalve de enige syndicus", async () => {
    const exp = await owner.raw("GET", "/api/auth/me/export"); expect(exp.status).toBe(200); expect((await exp.json()).memberships).toHaveLength(1);
    const del = await synd.del("/api/auth/me", { password: PW }); expect(del.status).toBe(400); expect(del.data.error).toContain("enige syndicus");
    const delT = await tenant.del("/api/auth/me", { password: "fout" }); expect(delT.status).toBe(400);
    const delT2 = await tenant.del("/api/auth/me", { password: PW }); expect(delT2.status).toBe(200);
    expect((await new Client().post("/api/auth/login", { email: tenantMail, password: PW })).status).toBe(401);
  });
});
