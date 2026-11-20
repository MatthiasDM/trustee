import { describe, expect, it } from "vitest";
import { as, Client } from "./client";

/** Hersteltest tegen de echte D1-engine: een gebouw exporteren, volledig kwijtraken en door platformbeheer laten terugzetten. */
describe("Back-up herstellen", () => {
  it("zet een verloren gebouw terug uit zijn export; enkel platformbeheer, en nooit over een bestaand gebouw heen", async () => {
    const demo = new Client();
    const B = (await demo.post("/api/demo/start", { name: "Residentie Herstel" })).data.buildingId as string;
    const up = await demo.upload(`/api/buildings/${B}/documents`, { category: "overig", visibility: "all" }, { name: "polis.pdf", content: "%PDF-1.4\n%%EOF", type: "application/pdf" }); expect(up.status).toBe(201);
    expect((await demo.post(`/api/buildings/${B}/suppliers`, { name: "Liften Peeters" })).status).toBeLessThan(300);
    const backup = (await demo.get(`/api/buildings/${B}/export`)).data;
    expect(backup.version).toBe(2); expect(backup.suppliers.length).toBe(1); expect(backup.users.length).toBe(5);

    // zolang het gebouw bestaat: geweigerd, ook voor platformbeheer
    const platform = await as("platform");
    expect((await platform.post("/api/admin/restore", { backup })).status).toBe(409);
    // gebouw, kantoor, gebruikers en bestanden weg
    expect((await demo.post("/api/demo/end")).status).toBe(200);
    expect((await platform.get(`/api/buildings/${B}/units`)).status).toBe(404);

    expect((await new Client().post("/api/admin/restore", { backup })).status).toBe(401);
    expect((await (await as("syndicus")).post("/api/admin/restore", { backup })).status).toBe(403);

    const r = await platform.post("/api/admin/restore", { backup }); expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ building_id: B, new_users: 5, org_restored: true, missing_documents: ["polis.pdf"] });

    const after = (await platform.get(`/api/buildings/${B}/export`)).data;
    // identiek, op het logboek na: dat kreeg de herstelling erbij, en de platformbeheerder die erin staat komt dus mee als gebruiker
    for (const t of Object.keys(backup).filter((k) => Array.isArray(backup[k]) && k !== "audit_log" && k !== "users")) expect(after[t], t).toEqual(backup[t]);
    expect(after.users.filter((u: any) => u.id !== "u-platform")).toEqual(backup.users);
    expect(after.audit_log.length).toBeGreaterThan(backup.audit_log.length);
    expect(after.audit_log.some((a: any) => a.action === "building.restore" && a.user_id === "u-platform")).toBe(true);
    // het herstelde gebouw werkt: boekhouding en kavels zijn leesbaar
    expect((await platform.get(`/api/buildings/${B}/units`)).data.units.length).toBe(5);
    expect((await platform.get(`/api/buildings/${B}/ledger/entries`)).status).toBe(200);
    expect((await platform.post("/api/admin/restore", { backup })).status).toBe(409);
  });
});
