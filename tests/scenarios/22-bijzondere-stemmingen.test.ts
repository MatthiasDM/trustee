import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

/** Stemming over lasten van bepaalde mede-eigenaars (art. 3.87 §6, lid 2) en nieuwe AV bij eenparigheid gemist door afwezigheid (art. 3.88 §4). */
describe("Bijzondere stemmingen", () => {
  let synd: Client; const made: string[] = [];
  const ago = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
  beforeAll(async () => { synd = await as("syndicus"); });
  afterAll(async () => { for (const id of made) await synd.post(`/api/buildings/${B}/meetings/${id}/cancel`, { reason: "Einde test bijzondere stemmingen" }); });

  it("enkel wie de liftkosten draagt (A2, A3) stemt, naar zijn aandeel in die lasten", async () => {
    const mid = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV liftstemming", type: "av", starts_at: ago(1) })).data.id; made.push(mid);
    const item = (await synd.post(`/api/buildings/${B}/agenda`, { title: "Liftrenovatie", meeting_id: mid })).data.id;
    expect((await synd.patch(`/api/buildings/${B}/agenda/${item}`, { charge_key_id: "ck-lift" })).status).toBe(200);
    // A1 (geen liftkosten) stemt tegen, maar telt niet mee; A2 vóór (300), A3 tegen (350) → verworpen
    const r = await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${item}/vote`, { votes: [{ unit_id: "un-a1", choice: "against" }, { unit_id: "un-a2", choice: "for" }, { unit_id: "un-a3", choice: "against" }, { unit_id: "un-g1", choice: "against" }] });
    expect(r.data.votes_for).toBe(300); expect(r.data.eligible).toBe(650); expect(r.data.reached).toBe(false);
    expect(r.data.capped[0]).toMatchObject({ name: "Ahmed El Idrissi", had: 350, counted: 300 }); expect(r.data.votes_against).toBe(300); // stemplafond geldt ook binnen deze stemming
    expect(r.data.decision).toMatch(/3\.87 §6, lid 2/);
  });

  it("eenparigheid gemist door afwezigheid → nieuwe AV na minstens 30 dagen beslist met eenparigheid van de aanwezigen", async () => {
    const first = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV eenparig 1", type: "av", starts_at: ago(40) })).data.id; made.push(first);
    const i1 = (await synd.post(`/api/buildings/${B}/agenda`, { title: "Wijziging aandelen", meeting_id: first, required_majority: "unanimous" })).data.id;
    const present = [{ unit_id: "un-a1", choice: "for" }, { unit_id: "un-a2", choice: "for" }, { unit_id: "un-g1", choice: "for" }, { unit_id: "un-g2", choice: "for" }, { unit_id: "un-a3", choice: "absent" }];
    const r1 = await synd.post(`/api/buildings/${B}/meetings/${first}/agenda/${i1}/vote`, { votes: present });
    expect(r1.data.reached).toBe(false); expect(r1.data.missed_by_absence).toBe(true); expect(r1.data.decision).toMatch(/3\.88 §4/);
    expect((await synd.post(`/api/buildings/${B}/meetings`, { title: "AV eenparig 2 te vroeg", type: "av", starts_at: ago(20), unanimity_followup_of: first })).data.error).toMatch(/dertig dagen/);
    const second = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV eenparig 2", type: "av", starts_at: ago(5), unanimity_followup_of: first })).data.id; made.push(second);
    const i2 = (await synd.post(`/api/buildings/${B}/agenda`, { title: "Wijziging aandelen (tweede AV)", meeting_id: second, required_majority: "unanimous" })).data.id;
    const r2 = await synd.post(`/api/buildings/${B}/meetings/${second}/agenda/${i2}/vote`, { votes: present });
    expect(r2.data.reached).toBe(true);
    const r3 = await synd.post(`/api/buildings/${B}/meetings/${second}/agenda/${i2}/vote`, { votes: present.map((v) => v.unit_id === "un-g2" ? { ...v, choice: "abstain" } : v), dry_run: true });
    expect(r3.data.reached).toBe(false); // ook op de tweede AV moet elke aanwezige akkoord gaan
  });
});
