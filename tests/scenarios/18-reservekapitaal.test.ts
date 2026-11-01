import { afterAll, describe, expect, it } from "vitest";
import { B, as } from "./client";

/** Verplicht reservekapitaal (art. 3.86 §3 BW): na 5 jaar, minstens 5 % van de gewone lasten van het vorige boekjaar, tenzij 4/5 anders beslist. */
describe("Verplicht reservekapitaal", () => {
  afterAll(async () => { await (await as("syndicus")).patch(`/api/buildings/${B}`, { provisional_acceptance_date: null, reserve_waiver_item_id: null }); });
  it("zonder opleveringsdatum geen oordeel; daarna 5 % van de gewone lasten van het vorige boekjaar; 4/5-beslissing ontslaat", async () => {
    const synd = await as("syndicus");
    expect((await synd.get(`/api/buildings/${B}/ledger/reserve-check?fy=fy-2027`)).data.status).toBe("no_date");
    await synd.patch(`/api/buildings/${B}`, { provisional_acceptance_date: "2022-06-01" });
    const notYet = (await synd.get(`/api/buildings/${B}/ledger/reserve-check?fy=fy-2026`)).data; expect(notYet.status).toBe("not_yet"); expect(notYet.obligation_from).toBe("2027-06-01");
    await synd.patch(`/api/buildings/${B}`, { provisional_acceptance_date: "2015-01-01" });
    const r = (await synd.get(`/api/buildings/${B}/ledger/reserve-check?fy=fy-2027`)).data;
    expect(r.previous_year).toBe("2026"); expect(r.ordinary_charges_prev).toBeGreaterThan(10000);
    expect(Math.abs(r.minimum - r.ordinary_charges_prev * 0.05)).toBeLessThanOrEqual(0.0051); // afronding op de cent
    expect(r.called_reserve).toBe(0); expect(r.status).toBe("short"); expect(r.message).toMatch(/3\.86 §3/);
    expect(r.has_working_account).toBe(true); expect(r.has_reserve_account).toBe(true);
    // een gewone meerderheid volstaat niet als ontheffing
    const mid = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV reservekapitaal", type: "av", starts_at: new Date(Date.now() - 3 * 86400_000).toISOString() })).data.id;
    const simple = (await synd.post(`/api/buildings/${B}/agenda`, { title: "Geen reservekapitaal (gewone meerderheid)", meeting_id: mid })).data.id;
    const fourFifths = (await synd.post(`/api/buildings/${B}/agenda`, { title: "Geen verplicht reservekapitaal", meeting_id: mid, required_majority: "four_fifths" })).data.id;
    const all = ["un-a1", "un-a2", "un-a3", "un-g1", "un-g2"].map((u) => ({ unit_id: u, choice: "for" }));
    for (const id of [simple, fourFifths]) await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${id}/vote`, { votes: all });
    expect((await synd.patch(`/api/buildings/${B}`, { reserve_waiver_item_id: simple })).status).toBe(400);
    expect((await synd.patch(`/api/buildings/${B}`, { reserve_waiver_item_id: fourFifths })).status).toBe(200);
    const w = (await synd.get(`/api/buildings/${B}/ledger/reserve-check?fy=fy-2027`)).data; expect(w.status).toBe("waived"); expect(w.waiver.title).toBe("Geen verplicht reservekapitaal");
  });
});
