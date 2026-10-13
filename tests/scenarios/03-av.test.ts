import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

describe("Algemene vergadering: agenda, volmachten, quorum, stemming, notulen", () => {
  let synd: Client, marie: Client, jan: Client, ahmed: Client, lotte: Client; let meetingId = ""; let itemId = "";
  beforeAll(async () => { [synd, marie, jan, ahmed, lotte] = await Promise.all(["syndicus", "marie", "jan", "ahmed", "lotte"].map(as)); });

  it("syndicus plant een AV; eigenaar dient een agendapunt in dat geagendeerd wordt", async () => {
    const m = await synd.post(`/api/buildings/${B}/meetings`, { title: "Test-AV", type: "av", starts_at: new Date(Date.now() + 20 * 86400_000).toISOString(), location: "Online", notify: false }); expect(m.status).toBe(201); meetingId = m.data.id;
    const a = await marie.post(`/api/buildings/${B}/agenda`, { title: "Laadpalen plaatsen", description: "4 laadpunten", required_majority: "two_thirds" }); expect(a.status).toBe(201); itemId = a.data.id;
    expect((await lotte.post(`/api/buildings/${B}/agenda`, { title: "x" })).status).toBe(403);
    await marie.patch(`/api/buildings/${B}/agenda/${itemId}`, { meeting_id: meetingId }); // indiener kan niet zelf agenderen: wordt genegeerd
    expect((await marie.get(`/api/buildings/${B}/agenda?meeting=none`)).data.items.find((i: any) => i.id === itemId).status).toBe("proposed");
    expect((await synd.patch(`/api/buildings/${B}/agenda/${itemId}`, { meeting_id: meetingId })).status).toBe(200);
    const list = await marie.get(`/api/buildings/${B}/agenda?meeting=${meetingId}`); expect(list.data.items[0].status).toBe("scheduled");
  });
  it("volmachtregels: niet aan syndicus, niet aan huurder, niet aan jezelf, max 3", async () => {
    expect((await marie.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: "u-syndicus" })).data.error).toMatch(/syndicus/);
    expect((await marie.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: "u-lotte" })).status).toBe(400);
    expect((await marie.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: "u-marie" })).status).toBe(400);
    expect((await marie.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: "u-jan" })).status).toBe(200);
    expect((await jan.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "attending" })).status).toBe(200);
    expect((await ahmed.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "absent" })).status).toBe(200);
  });
  it("quorum: A1+A2 (volmacht)+G1+G2 = 650/1000 en 2 van 3 eigenaars → bereikt; leden zien geen namen", async () => {
    const a = await synd.get(`/api/buildings/${B}/meetings/${meetingId}/attendance`);
    expect(a.data.quorum.present_shares).toBe(650); expect(a.data.quorum.reached).toBe(true); expect(a.data.rows.find((r: any) => r.label === "A2").status).toBe("proxy");
    const m = await marie.get(`/api/buildings/${B}/meetings/${meetingId}/attendance`); expect(m.data.rows).toHaveLength(0); expect(m.data.quorum.reached).toBe(true);
  });
  it("stemming tijdens de AV: 2/3 niet gehaald bij 600 voor / 350 tegen; tegenstemmers met naam", async () => {
    const r = await synd.post(`/api/buildings/${B}/meetings/${meetingId}/agenda/${itemId}/vote`, { votes: [{ unit_id: "un-a1", choice: "for" }, { unit_id: "un-a2", choice: "for" }, { unit_id: "un-a3", choice: "against" }, { unit_id: "un-g1", choice: "for" }, { unit_id: "un-g2", choice: "abstain" }] });
    expect(r.status).toBe(200); expect(r.data.reached).toBe(false); expect(r.data.dissenters[0]).toContain("Ahmed"); expect(r.data.decision).toMatch(/Verworpen/);
    expect((await marie.post(`/api/buildings/${B}/meetings/${meetingId}/agenda/${itemId}/vote`, { votes: [] })).status).toBe(403);
    const r2 = await synd.post(`/api/buildings/${B}/meetings/${meetingId}/agenda/${itemId}/vote`, { votes: [{ unit_id: "un-a1", choice: "for" }, { unit_id: "un-a2", choice: "for" }, { unit_id: "un-a3", choice: "for" }, { unit_id: "un-g1", choice: "for" }, { unit_id: "un-g2", choice: "for" }] });
    expect(r2.data.reached).toBe(true); expect(r2.data.pct).toBe(1);
  });
  it("notulen: ontwerp bevat aanwezigheid en beslissing; definitief → document, melding, vergrendeld", async () => {
    await synd.patch(`/api/buildings/${B}/meetings/${meetingId}`, { chair_user_id: "u-jan", notify: false });
    const g = await synd.post(`/api/buildings/${B}/meetings/${meetingId}/minutes/generate`); expect(g.status).toBe(200); expect(g.data.body).toContain("Laadpalen plaatsen"); expect(g.data.body).toContain("Voorzitter: Jan Peeters"); expect(g.data.body).toMatch(/quorum/i);
    expect((await jan.post(`/api/buildings/${B}/meetings/${meetingId}/minutes/finalize`)).status).toBe(403); // raad mag niet finaliseren
    const f = await synd.post(`/api/buildings/${B}/meetings/${meetingId}/minutes/finalize`); expect(f.status).toBe(200);
    const doc = await marie.raw("GET", `/api/buildings/${B}/documents/${f.data.documentId}/download?inline=1`); expect(doc.status).toBe(200); expect(doc.headers.get("content-type")).toContain("text/html"); expect(doc.headers.get("content-security-policy")).toContain("sandbox");
    const n = await marie.get("/api/notifications"); expect(n.data.items.some((x: any) => x.type === "minutes" && x.title.includes("Test-AV"))).toBe(true);
    expect((await synd.post(`/api/buildings/${B}/meetings/${meetingId}/minutes/generate`)).status).toBe(400);
  });
  it("verzoek tot AV: 1/5 van de aandelen, huurder uitgesloten, deadline 30 dagen", async () => {
    const r = await marie.post(`/api/buildings/${B}/meeting-requests`, { subject: "Test-verzoek" }); expect(r.status).toBe(201);
    expect((await lotte.post(`/api/buildings/${B}/meeting-requests/${r.data.id}/sign`)).status).toBe(403);
    const s = await jan.post(`/api/buildings/${B}/meeting-requests/${r.data.id}/sign`); expect(s.data.reached).toBe(true); expect(s.data.status).toBe("threshold_reached"); expect(s.data.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await marie.patch(`/api/buildings/${B}/meeting-requests/${r.data.id}`, { status: "fulfilled" })).status).toBe(403);
    expect((await synd.patch(`/api/buildings/${B}/meeting-requests/${r.data.id}`, { status: "fulfilled", fulfilled_meeting_id: meetingId })).status).toBe(200);
  });
  it("schriftelijke besluitvorming: één tegenstem verwerpt, eenparigheid neemt aan", async () => {
    const mk = async () => (await synd.post(`/api/buildings/${B}/polls`, { title: "Schriftelijk test", options: ["x", "y"], written: true })).data.id as string;
    const p1 = await mk(); const opts = (await synd.get(`/api/buildings/${B}/polls/${p1}`)).data.options;
    expect(opts.map((o: any) => o.label)).toEqual(["Akkoord", "Niet akkoord"]);
    await marie.post(`/api/buildings/${B}/polls/${p1}/vote`, { option_ids: [opts[1].id] });
    expect((await synd.get(`/api/buildings/${B}/polls/${p1}`)).data.outcome).toBe("rejected");
    const p2 = await mk(); const o2 = (await synd.get(`/api/buildings/${B}/polls/${p2}`)).data.options;
    for (const c of [marie, jan]) await c.post(`/api/buildings/${B}/polls/${p2}/vote`, { option_ids: [o2[0].id] });
    expect((await synd.get(`/api/buildings/${B}/polls/${p2}`)).data.status).toBe("open");
    await ahmed.post(`/api/buildings/${B}/polls/${p2}/vote`, { option_ids: [o2[0].id] });
    const done = await synd.get(`/api/buildings/${B}/polls/${p2}`); expect(done.data.outcome).toBe("adopted"); expect(done.data.status).toBe("closed");
    expect((await lotte.post(`/api/buildings/${B}/polls/${p2}/vote`, { option_ids: [o2[0].id] })).status).toBe(400);
  });
});
