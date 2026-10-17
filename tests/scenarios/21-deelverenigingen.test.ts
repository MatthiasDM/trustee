import { describe, expect, it } from "vitest";
import { as, uniq } from "./client";

/** Deelverenigingen (art. 3.84 BW): vanaf 20 kavels, eigen VME met spiegelkavels die de eigenaars van de hoofdvereniging volgen. */
describe("Deelverenigingen", () => {
  it("oprichten vanaf 20 kavels, eigenaars synchroon, spiegelkavels niet rechtstreeks wijzigen, verkoop rekent ook de deelvereniging af", async () => {
    const synd = await as("syndicus"); const marie = await as("marie"); const jan = await as("jan");
    const nb = (await synd.post("/api/buildings", { org_id: "org-demo", name: "Residentie Groep", address: "Plein 1", total_shares: 1000 })).data.id as string;
    const units = (await synd.post(`/api/buildings/${nb}/units`, Array.from({ length: 19 }, (_, i) => ({ label: `B${i + 1}`, type: "appartement", shares: 50 })))).data.ids as string[];
    const doc = (await synd.upload(`/api/buildings/${nb}/documents`, { category: "statuten", visibility: "all" }, { name: "basisakte.pdf", content: "%PDF-1.4\n%%EOF", type: "application/pdf" })).data.id;
    const create = (sel: string[]) => synd.post(`/api/buildings/${nb}/sub-associations`, { name: "Deelvereniging Blok B", scope: "Lift en dak van blok B", basis: "basisakte", document_id: doc, units: sel.map((id, i) => ({ unit_id: id, shares: (i + 1) * 100 })) });
    expect((await create(units.slice(0, 2))).data.error).toMatch(/twintig kavels/);
    units.push(...(await synd.post(`/api/buildings/${nb}/units`, [{ label: "B20", type: "appartement", shares: 50 }])).data.ids);
    for (const [u, i] of [["u-marie", 0], ["u-jan", 1]] as const) await synd.put(`/api/buildings/${nb}/units/${units[i]}/owners`, { owners: [{ user_id: u, share_pct: 100 }] });
    expect((await synd.post(`/api/buildings/${nb}/sub-associations`, { name: "Zonder akte", scope: "x scope", basis: "basisakte", units: [{ unit_id: units[0], shares: 1 }, { unit_id: units[1], shares: 1 }] })).data.error).toMatch(/basisakte/);
    const r = await create([units[0], units[1]]); expect(r.status).toBe(201); const sub = r.data.id as string;
    // eigenaars zijn lid van de deelvereniging, met de koppeling naar de hoofdvereniging
    const m = (await marie.get("/api/auth/me")).data.buildings.find((x: any) => x.id === sub);
    expect(m.parent_building_id).toBe(nb); expect(m.parent_name).toBe("Residentie Groep"); expect(m.role).toBe("eigenaar");
    const su = (await synd.get(`/api/buildings/${sub}/units`)).data; expect(su.total_shares).toBe(300);
    const mirror = su.units.find((u: any) => u.label === "B1"); expect(mirror.owners.map((o: any) => o.name)).toEqual(["Marie Claes"]);
    expect((await synd.put(`/api/buildings/${sub}/units/${mirror.id}/owners`, { owners: [] })).data.error).toMatch(/hoofdvereniging/);
    expect((await synd.post(`/api/buildings/${sub}/sub-associations`, { name: "Sub van sub", scope: "iets", basis: "basisakte", document_id: doc, units: [] })).status).toBe(400);
    // eigenaar wijzigt in de hoofdvereniging → spiegelkavel volgt; Marie verlaat de deelvereniging
    await synd.put(`/api/buildings/${nb}/units/${units[0]}/owners`, { owners: [{ user_id: "u-ahmed", share_pct: 100 }] });
    expect((await synd.get(`/api/buildings/${sub}/units`)).data.units.find((u: any) => u.label === "B1").owners.map((o: any) => o.name)).toEqual(["Ahmed El Idrissi"]);
    expect((await marie.get(`/api/buildings/${sub}`)).status).toBe(403);
    // verkoop in de hoofdvereniging rekent ook de deelvereniging af (of meldt waarom niet)
    await synd.post(`/api/buildings/${nb}/ledger/fiscal-years`, { label: "2026", start_date: "2026-01-01", end_date: "2026-12-31" });
    const t = await synd.post(`/api/buildings/${nb}/units/${units[1]}/transfer`, { transfer_date: "2026-10-01", buyer_email: `${uniq("koper")}@t.be` });
    expect(t.status).toBe(201); expect(t.data.sub_associations[0].name).toBe("Deelvereniging Blok B"); expect(t.data.sub_associations[0].skipped).toMatch(/boekjaar/);
    await synd.post(`/api/buildings/${sub}/ledger/fiscal-years`, { label: "2026", start_date: "2026-01-01", end_date: "2026-12-31" });
    expect((await synd.post(`/api/buildings/${sub}/units/${mirror.id}/transfer`, { transfer_date: "2026-10-01", buyer_user_id: "u-jan" })).data.error).toMatch(/hoofdvereniging/);
    expect((await jan.get(`/api/buildings/${sub}`)).status).toBe(403); // Jan verkocht zijn enige kavel in de deelvereniging
  });
});
