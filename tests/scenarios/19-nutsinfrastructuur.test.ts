import { describe, expect, it } from "vitest";
import { B, BASE, as } from "./client";

/** Kabels en leidingen in de gemene delen (art. 3.82 §2 BW): aankondiging, verzettermijn van twee maanden vanaf ontvangst, wettelijke gronden. */
describe("Werken aan nutsinfrastructuur", () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  it("mede-eigenaar kondigt aan; termijn loopt pas na ontvangst; verzet enkel binnen twee maanden; starten pas daarna", async () => {
    const synd = await as("syndicus"); const marie = await as("marie"); const jan = await as("jan"); const lotte = await as("lotte");
    const body = { domain: "telecommunicatie", description: "Glasvezel van de kelder naar A2 via de koker", justification: "Koper haalt geen 30 Mbps", sender_address: "Zeedijk 12 bus 2, 8400 Oostende" };
    expect((await lotte.post(`/api/buildings/${B}/infrastructure`, body)).status).toBe(403);
    expect((await marie.post(`/api/buildings/${B}/infrastructure`, { ...body, operator_name: "Proximus" })).status).toBe(403);
    const id = (await marie.post(`/api/buildings/${B}/infrastructure`, body)).data.id;
    const get = async () => (await jan.get(`/api/buildings/${B}/infrastructure`)).data.items.find((x: any) => x.id === id);
    expect((await get()).status).toBe("awaiting_receipt");
    expect((await jan.patch(`/api/buildings/${B}/infrastructure/${id}`, { objection_ground: "existing" })).data.error).toMatch(/ontvangst/);
    expect((await marie.patch(`/api/buildings/${B}/infrastructure/${id}`, { received_at: day(0) })).status).toBe(403);
    expect((await synd.patch(`/api/buildings/${B}/infrastructure/${id}`, { received_at: day(-70) })).status).toBe(200);
    expect((await get()).status).toBe("allowed");
    expect((await jan.patch(`/api/buildings/${B}/infrastructure/${id}`, { objection_ground: "damage" })).data.error).toMatch(/verval/);
    expect((await marie.patch(`/api/buildings/${B}/infrastructure/${id}`, { progress: "started" })).status).toBe(200);
    // tweede aankondiging: binnen de termijn, verzet op wettelijke grond, starten geweigerd
    const id2 = (await marie.post(`/api/buildings/${B}/infrastructure`, { ...body, description: "Laadkabel van de meter naar garage G2" })).data.id;
    await synd.patch(`/api/buildings/${B}/infrastructure/${id2}`, { received_at: day(-50) });
    const it2 = (await jan.get(`/api/buildings/${B}/infrastructure`)).data.items.find((x: any) => x.id === id2); expect(it2.status).toBe("objection_period");
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    expect((await synd.get("/api/notifications")).data.items.some((n: any) => /^Nog \d+ dagen voor verzet/.test(n.title))).toBe(true);
    expect((await marie.patch(`/api/buildings/${B}/infrastructure/${id2}`, { objection_ground: "existing" })).status).toBe(400); // niet tegen eigen werken
    expect((await jan.patch(`/api/buildings/${B}/infrastructure/${id2}`, { objection_ground: "damage", objection_note: "Kabel over de gevel" })).status).toBe(200);
    const o = (await marie.get(`/api/buildings/${B}/infrastructure`)).data.items.find((x: any) => x.id === id2); expect(o.status).toBe("objected"); expect(o.objection_ground_label).toMatch(/uitzicht/);
    expect((await marie.patch(`/api/buildings/${B}/infrastructure/${id2}`, { progress: "started" })).status).toBe(400);
    // operator via de syndicus; planning vóór het einde van de termijn wordt geweigerd
    expect((await synd.post(`/api/buildings/${B}/infrastructure`, { ...body, operator_name: "Fluvius", received_at: day(0), planned_start: day(10) })).status).toBe(400);
    expect((await synd.post(`/api/buildings/${B}/infrastructure`, { ...body, operator_name: "Fluvius", received_at: day(0), planned_start: day(70) })).status).toBe(201);
  });
});
