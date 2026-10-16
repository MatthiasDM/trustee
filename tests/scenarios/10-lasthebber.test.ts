import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

/** Gesplitste eigendom (art. 3.87 §1, lid 2 BW): deelnamerecht geschorst tot er één lasthebber is; die stemt voor de hele kavel. */
describe("Lasthebber bij gesplitste eigendom", () => {
  let synd: Client, jan: Client, marie: Client, ahmed: Client, lotte: Client; let meetingId = "";
  const owners = (B2: Client, unit: string, list: any[]) => B2.put(`/api/buildings/${B}/units/${unit}/owners`, { owners: list });
  beforeAll(async () => {
    [synd, jan, marie, ahmed, lotte] = await Promise.all(["syndicus", "jan", "marie", "ahmed", "lotte"].map(as));
    meetingId = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV lasthebbertest", type: "av", starts_at: new Date(Date.now() + 30 * 86400_000).toISOString() })).data.id;
  });
  afterAll(async () => {
    await owners(synd, "un-g2", [{ user_id: "u-marie", share_pct: 100 }]); await synd.put(`/api/buildings/${B}/units/un-g2/representative`, { user_id: null });
    await owners(synd, "un-a2", [{ user_id: "u-marie", share_pct: 100 }]); await synd.put(`/api/buildings/${B}/units/un-a2/representative`, { user_id: null });
    await synd.post(`/api/buildings/${B}/meetings/${meetingId}/cancel`, { reason: "Einde test lasthebber" });
  });

  it("vruchtgebruik + blote eigendom zonder lasthebber: kavel geschorst, gewicht naar niemand", async () => {
    const r = await owners(synd, "un-g2", [{ user_id: "u-marie", share_pct: 100, right_type: "blote_eigendom" }, { user_id: "u-ahmed", share_pct: 100, right_type: "vruchtgebruik" }]);
    expect(r.data.split).toBe(true); expect(r.data.suspended).toBe(true);
    const g2 = (await marie.get(`/api/buildings/${B}/units`)).data.units.find((u: any) => u.id === "un-g2");
    expect(g2.split).toBe(true); expect(g2.suspended).toBe(true); expect(g2.owners.map((o: any) => o.right_type).sort()).toEqual(["blote_eigendom", "vruchtgebruik"]);
    const att = (await synd.get(`/api/buildings/${B}/meetings/${meetingId}/attendance`)).data;
    expect(att.rows.find((x: any) => x.label === "G2").status).toBe("suspended"); expect(att.suspended_units).toEqual(["G2"]);
    const prev = (await synd.get(`/api/buildings/${B}/meetings/${meetingId}/convene`)).data; expect(prev.warnings.join(" ")).toMatch(/G2: gesplitste eigendom zonder lasthebber/);
    // gewogen stemming: Marie weegt enkel nog A2 (300), Ahmed enkel A3 (350)
    const pid = (await synd.post(`/api/buildings/${B}/polls`, { title: "Gewicht lasthebber", options: ["a", "b"], weighted: true })).data.id;
    const p = (await marie.get(`/api/buildings/${B}/polls/${pid}`)).data;
    expect((await marie.post(`/api/buildings/${B}/polls/${pid}/vote`, { option_ids: [p.options[0].id] })).data.options[0].weight).toBe(300);
    expect((await ahmed.post(`/api/buildings/${B}/polls/${pid}/vote`, { option_ids: [p.options[0].id] })).data.options[0].weight).toBe(650);
    // AV-stemming: geschorste kavel kan enkel afwezig zijn
    const item = (await synd.post(`/api/buildings/${B}/agenda`, { title: "Punt lasthebbertest", meeting_id: meetingId })).data.id;
    const bad = await synd.post(`/api/buildings/${B}/meetings/${meetingId}/agenda/${item}/vote`, { votes: [{ unit_id: "un-g2", choice: "for" }] });
    expect(bad.status).toBe(400); expect(bad.data.error).toMatch(/G2: deelnamerecht geschorst/);
    // schriftelijke besluitvorming: eenparigheid onmogelijk zolang een kavel geschorst is
    const w = (await synd.post(`/api/buildings/${B}/polls`, { title: "Schriftelijk met geschorste kavel", options: ["x", "y"], written: true })).data.id;
    const wo = (await synd.get(`/api/buildings/${B}/polls/${w}`)).data; expect(wo.written_progress.suspended).toEqual(["G2"]);
    for (const c of [jan, marie, ahmed]) await c.post(`/api/buildings/${B}/polls/${w}/vote`, { option_ids: [wo.options[0].id] });
    expect((await synd.get(`/api/buildings/${B}/polls/${w}`)).data.status).toBe("open");
  });

  it("lasthebber registreren: niet de syndicus of een huurder; daarna stemt hij voor de hele kavel", async () => {
    expect((await synd.put(`/api/buildings/${B}/units/un-g2/representative`, { user_id: "u-syndicus" })).status).toBe(400);
    expect((await synd.put(`/api/buildings/${B}/units/un-g2/representative`, { user_id: "u-lotte" })).status).toBe(400);
    expect((await marie.put(`/api/buildings/${B}/units/un-g2/representative`, { user_id: "u-ahmed" })).status).toBe(403);
    expect((await synd.put(`/api/buildings/${B}/units/un-g2/representative`, { user_id: "u-ahmed" })).status).toBe(200);
    const g2 = (await marie.get(`/api/buildings/${B}/units`)).data.units.find((u: any) => u.id === "un-g2"); expect(g2.suspended).toBe(false); expect(g2.voter_name).toBe("Ahmed El Idrissi");
    const pid = (await synd.post(`/api/buildings/${B}/polls`, { title: "Gewicht na lasthebber", options: ["a", "b"], weighted: true })).data.id;
    const p = (await ahmed.get(`/api/buildings/${B}/polls/${pid}`)).data;
    expect((await ahmed.post(`/api/buildings/${B}/polls/${pid}/vote`, { option_ids: [p.options[0].id] })).data.options[0].weight).toBe(400);
    expect((await ahmed.get("/api/notifications")).data.items.some((n: any) => /lasthebber voor kavel G2/.test(n.title))).toBe(true);
    const att = (await synd.get(`/api/buildings/${B}/meetings/${meetingId}/attendance`)).data; expect(att.rows.find((x: any) => x.label === "G2").owner_names).toMatch(/lasthebber Ahmed El Idrissi/);
  });

  it("wie enkel titularis is van een kavel met een andere lasthebber, neemt niet deel en geeft geen volmacht", async () => {
    await owners(synd, "un-a2", [{ user_id: "u-marie", share_pct: 50 }, { user_id: "u-lotte", share_pct: 50 }]);
    await synd.put(`/api/buildings/${B}/units/un-a2/representative`, { user_id: "u-marie" });
    const r = await lotte.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "attending" });
    expect(r.status).toBe(403); expect(r.data.error).toMatch(/enkel de lasthebber/);
    expect((await marie.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "attending" })).status).toBe(200);
    const att = (await synd.get(`/api/buildings/${B}/meetings/${meetingId}/attendance`)).data; expect(att.rows.find((x: any) => x.label === "A2").status).toBe("attending");
  });
});
