import { describe, expect, it } from "vitest";
import { B, as } from "./client";

/** Onverenigbaarheid (art. 3.89 §9 BW): een syndicus is niet tegelijk raadslid of commissaris in dezelfde VME. */
describe("Syndicus niet tegelijk raadslid of commissaris", () => {
  it("weigert raads- of commissarismandaat voor de syndicus, en syndicusmandaat voor een raadslid", async () => {
    const synd = await as("syndicus");
    const year = { start_date: "2026-01-01", end_date: "2026-12-31" };
    const r1 = await synd.post(`/api/buildings/${B}/mandates`, { organ: "raad", user_id: "u-syndicus", ...year }); expect(r1.status).toBe(400); expect(r1.data.error).toMatch(/3\.89 §9/);
    expect((await synd.post(`/api/buildings/${B}/mandates`, { organ: "commissaris", user_id: "u-syndicus", ...year })).status).toBe(400);
    const r3 = await synd.post(`/api/buildings/${B}/mandates`, { organ: "voorlopig_syndicus", basis: "av", user_id: "u-jan", ...year }); expect(r3.status).toBe(400); expect(r3.data.error).toMatch(/lid van de raad/);
    expect((await synd.patch(`/api/buildings/${B}/members/u-jan`, { role: "syndicus" })).status).toBe(400);
    // niet-overlappend mandaat in een ander jaar mag wel
    const jan = (await synd.get(`/api/buildings/${B}/mandates`)).data.mandates.find((m: any) => m.user_id === "u-jan" && m.organ === "raad");
    const after = new Date(new Date(jan.end_date).getTime() + 2 * 86400_000).toISOString().slice(0, 10);
    const ok = await synd.post(`/api/buildings/${B}/mandates`, { organ: "voorlopig_syndicus", basis: "av", user_id: "u-marie", start_date: after, end_date: after.replace(/^(\d{4})/, (y) => String(+y + 1)) });
    expect(ok.status, JSON.stringify(ok.data)).toBe(201); await synd.del(`/api/buildings/${B}/mandates/${ok.data.id}`);
  });
});
