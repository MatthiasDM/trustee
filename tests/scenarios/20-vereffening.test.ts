import { describe, expect, it } from "vitest";
import { as } from "./client";

/** Ontbinding en vereffening (art. 3.97 en 3.98 BW), in een apart testgebouw. */
describe("Ontbinding en vereffening", () => {
  it("ontbinding vraagt de juiste grond en stukken; vereffenaar krijgt syndicusrechten; na afsluiting enkel inzage", async () => {
    const synd = await as("syndicus"); const jan = await as("jan"); const marie = await as("marie");
    const nb = (await synd.post("/api/buildings", { org_id: "org-demo", name: "Residentie Vereffening", address: "Dijk 1", total_shares: 1000 })).data.id as string;
    const doc = (await synd.upload(`/api/buildings/${nb}/documents`, { category: "overig", visibility: "all" }, { name: "vonnis.pdf", content: "%PDF-1.4\n%%EOF", type: "application/pdf" })).data.id;
    expect((await synd.post(`/api/buildings/${nb}/dissolution`, { ground: "av_unanimous", dissolved_at: "2026-10-01" })).data.error).toMatch(/eenparigheid/);
    expect((await synd.post(`/api/buildings/${nb}/dissolution`, { ground: "court", dissolved_at: "2026-10-01" })).data.error).toMatch(/vonnis/);
    expect((await marie.post(`/api/buildings/${nb}/dissolution`, { ground: "court", dissolved_at: "2026-10-01", document_id: doc })).status).toBe(403);
    expect((await synd.post(`/api/buildings/${nb}/dissolution`, { ground: "court", dissolved_at: "2026-10-01", document_id: doc, liquidator_user_id: "u-jan" })).status).toBe(200);
    expect((await synd.post(`/api/buildings/${nb}/dissolution`, { ground: "court", dissolved_at: "2026-10-01", document_id: doc })).status).toBe(400); // al ontbonden
    // vereffenaar Jan (geen lid) ziet het gebouw met syndicusrechten
    const mine = (await jan.get("/api/auth/me")).data.buildings.find((x: any) => x.id === nb); expect(mine.role).toBe("syndicus"); expect(mine.dissolution_status).toBe("in_liquidation");
    expect((await jan.patch(`/api/buildings/${nb}`, { address: "Dijk 1A" })).status).toBe(200);
    const d = (await synd.get(`/api/buildings/${nb}/dissolution`)).data; expect(d.liquidator_label).toBe("Jan Peeters");
    // afsluiten vraagt slotakte en bewaarplaats
    expect((await jan.patch(`/api/buildings/${nb}/dissolution`, { close: true })).data.error).toMatch(/slotakte/);
    expect((await jan.patch(`/api/buildings/${nb}/dissolution`, { close: true, closing_act_document_id: doc, archive_place: "Notaris Janssens, Brugge", closed_at: "2026-10-15", transcribed_at: "2026-10-16" })).status).toBe(200);
    const closed = (await synd.get(`/api/buildings/${nb}/dissolution`)).data; expect(closed.dissolution_status).toBe("closed"); expect(closed.prescription_until).toBe("2031-10-16");
    expect((await synd.patch(`/api/buildings/${nb}`, { address: "Dijk 2" })).status).toBe(403);
    expect((await synd.get(`/api/buildings/${nb}`)).status).toBe(200);
    expect((await synd.raw("GET", `/api/buildings/${nb}/archive.zip`)).status).toBe(200);
    expect((await jan.get(`/api/buildings/${nb}`)).status).toBe(403); // vereffenaar heeft na de afsluiting geen rechten meer
  });
});
