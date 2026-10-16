import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

/** Stemplafond (art. 3.87 §8, lid 2) en belangenconflict (art. 3.87 §9) bij de stemming tijdens de AV. */
describe("Stemplafond en belangenconflict", () => {
  let synd: Client, jan: Client, marie: Client, ahmed: Client; let mid = "";
  const allFor = (except: Record<string, string> = {}) => ["un-a1", "un-a2", "un-a3", "un-g1", "un-g2"].map((u) => ({ unit_id: u, choice: except[u] ?? "for" }));
  const newItem = async (title: string) => (await synd.post(`/api/buildings/${B}/agenda`, { title, meeting_id: mid })).data.id as string;
  beforeAll(async () => {
    [synd, jan, marie, ahmed] = await Promise.all(["syndicus", "jan", "marie", "ahmed"].map(as));
    mid = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV plafondtest", type: "av", starts_at: new Date(Date.now() + 30 * 86400_000).toISOString() })).data.id;
    await jan.put(`/api/buildings/${B}/meetings/${mid}/rsvp`, { status: "attending" });            // A1 + G1 = 300
    await marie.put(`/api/buildings/${B}/meetings/${mid}/rsvp`, { status: "attending" });          // A2 + G2 = 350
    await ahmed.put(`/api/buildings/${B}/meetings/${mid}/rsvp`, { status: "proxy", proxy_user_id: "u-marie" }); // A3 = 350 via Marie
  });
  afterAll(async () => { await synd.post(`/api/buildings/${B}/meetings/${mid}/cancel`, { reason: "Einde test stemplafond" }); });

  it("Marie (700 met volmacht) telt voor hoogstens de 300 van Jan: de uitslag keert om", async () => {
    const id = await newItem("Plafondpunt");
    const dry = await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${id}/vote`, { votes: allFor({ "un-a1": "against", "un-g1": "against" }), dry_run: true });
    expect(dry.data.capped).toEqual([{ person_id: "u-marie", name: "Marie Claes", had: 700, counted: 300 }]);
    expect(dry.data.votes_for).toBe(300); expect(dry.data.votes_against).toBe(300); expect(dry.data.reached).toBe(false);
    expect((await synd.get(`/api/buildings/${B}/agenda?meeting=${mid}`)).data.items.find((i: any) => i.id === id).status).toBe("scheduled"); // proefberekening bewaart niets
    const r = await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${id}/vote`, { votes: allFor({ "un-a1": "against", "un-g1": "against" }) });
    expect(r.status).toBe(200); expect(r.data.decision).toMatch(/Verworpen/); expect(r.data.decision).toMatch(/Stemplafond toegepast \(art\. 3\.87 §8 BW\): Marie Claes telde voor 300 in plaats van 700/);
    const saved = (await synd.get(`/api/buildings/${B}/agenda?meeting=${mid}`)).data.items.find((i: any) => i.id === id);
    expect(saved.vote_adjustments.capped[0].counted).toBe(300);
  });

  it("belangenconflict: Jan neemt niet deel; enkel het bestuur legt het vast", async () => {
    const id = await newItem("Offerte aannemer Peeters");
    expect((await marie.patch(`/api/buildings/${B}/agenda/${id}`, { conflict_user_ids: ["u-jan"] })).status).toBe(403);
    expect((await synd.patch(`/api/buildings/${B}/agenda/${id}`, { conflict_user_ids: ["u-jan"], conflict_reason: "Jan is zaakvoerder van de aannemer" })).status).toBe(200);
    const item = (await marie.get(`/api/buildings/${B}/agenda?meeting=${mid}`)).data.items.find((i: any) => i.id === id);
    expect(item.conflict_names).toEqual(["Jan Peeters"]); expect(item.conflict_reason).toMatch(/zaakvoerder/);
    const r = await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${id}/vote`, { votes: allFor({ "un-a1": "against", "un-g1": "against" }) });
    expect(r.data.excluded.map((x: any) => x.label).sort()).toEqual(["A1", "G1"]);
    expect(r.data.votes_against).toBe(0); expect(r.data.votes_for).toBe(700); expect(r.data.capped).toEqual([]); expect(r.data.reached).toBe(true);
    expect(r.data.decision).toMatch(/belangenconflict \(art\. 3\.87 §9 BW\) — Jan is zaakvoerder van de aannemer: kavel A1 \(Jan Peeters\), G1 \(Jan Peeters\)/);
  });

  it("wie een conflict heeft, stemt ook niet via de volmachten die hij draagt", async () => {
    const id = await newItem("Contract met Marie");
    await synd.patch(`/api/buildings/${B}/agenda/${id}`, { conflict_user_ids: ["u-marie"] });
    const r = await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${id}/vote`, { votes: allFor(), dry_run: true });
    expect(r.data.excluded.map((x: any) => x.label).sort()).toEqual(["A2", "A3", "G2"]);
    expect(r.data.votes_for).toBe(300);
  });

  it("een online stemming bij een agendapunt weigert wie een belangenconflict heeft", async () => {
    const id = await newItem("Onderhoudscontract Ahmed");
    await synd.patch(`/api/buildings/${B}/agenda/${id}`, { conflict_user_ids: ["u-ahmed"] });
    const pid = (await synd.post(`/api/buildings/${B}/agenda/${id}/poll`, {})).data.pollId;
    const opts = (await ahmed.get(`/api/buildings/${B}/polls/${pid}`)).data.options;
    const v = await ahmed.post(`/api/buildings/${B}/polls/${pid}/vote`, { option_ids: [opts[0].id] }); expect(v.status).toBe(403); expect(v.data.error).toMatch(/belangenconflict/);
    expect((await jan.post(`/api/buildings/${B}/polls/${pid}/vote`, { option_ids: [opts[0].id] })).status).toBe(200);
  });
});
