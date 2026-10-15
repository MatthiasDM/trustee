import { describe, expect, it } from "vitest";
import { BASE, Client } from "./client";

/** Demo-modus: wegwerpgebouw met één klik, wisselen van gebruiker, opruiming na 24 u inactiviteit. */
describe("Demo-modus", () => {
  it("start een volledig geseed gebouw, wisselt van gebruiker, en ruimt op na inactiviteit", async () => {
    const anon = new Client();
    expect((await anon.get("/api/demo/status")).data.enabled).toBe(true);
    expect((await anon.get("/api/auth/me")).data.demo_enabled).toBe(true);
    const r = await anon.post("/api/demo/start", { name: "Demo Residentie Test" }); expect(r.status).toBe(201);
    const B = r.data.buildingId as string; expect(B).toMatch(/^b-zeezicht-d[a-z0-9]+$/);
    const me = (await anon.get("/api/auth/me")).data;
    expect(me.user.name).toBe("Sofie Vermeulen"); expect(me.user.email).toMatch(/@demo\.invalid$/); expect(me.consents_required).toEqual([]);
    expect(me.demo.users.map((u: any) => u.role)).toEqual(["syndicus", "raad", "eigenaar", "eigenaar", "huurder"]);
    expect(me.buildings.find((b: any) => b.id === B).name).toBe("Demo Residentie Test");
    // volledig geseed: kavels, vergadering, stemming, boekhouding
    expect((await anon.get(`/api/buildings/${B}/units`)).data.units.length).toBe(5);
    expect((await anon.get(`/api/buildings/${B}/meetings`)).data.length).toBe(1);
    expect((await anon.get(`/api/buildings/${B}/polls`)).data.length).toBe(1);
    const summary = await anon.get(`/api/buildings/${B}/ledger/entries`); expect(summary.status).toBe(200); expect(summary.data.length ?? summary.data.entries?.length).toBeGreaterThan(10);
    // wisselen naar Marie: andere rechten
    const marie = me.demo.users.find((u: any) => u.name === "Marie Claes");
    expect((await anon.post("/api/demo/switch", { user_id: marie.id })).status).toBe(200);
    const me2 = (await anon.get("/api/auth/me")).data; expect(me2.user.id).toBe(marie.id); expect(me2.buildings[0].role).toBe("eigenaar");
    expect((await anon.patch(`/api/buildings/${B}`, { name: "x" })).status).toBe(403);
    // niet naar een gebruiker buiten de demo
    expect((await anon.post("/api/demo/switch", { user_id: "u-syndicus" })).status).toBe(404);
    // tweede demo is onafhankelijk
    const other = new Client(); const r2 = await other.post("/api/demo/start", {}); expect(r2.data.buildingId).not.toBe(B);
    expect((await other.post("/api/demo/switch", { user_id: marie.id })).status).toBe(404);
    // opruiming: nog actief → blijft; verouderd → weg, inclusief gebruikers
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    expect((await anon.get(`/api/buildings/${B}`)).status).toBe(200);
    expect((await anon.post("/api/demo/age")).status).toBe(200);
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    expect((await anon.get(`/api/buildings/${B}`)).status).toBe(401); // gebruiker bestaat niet meer → sessie ongeldig
    expect((await other.get(`/api/buildings/${r2.data.buildingId}`)).status).toBe(200); // andere demo onaangeroerd
    expect((await other.post("/api/demo/end")).status).toBe(200);
    expect((await other.get("/api/auth/me")).data.user).toBeNull();
  });
});
