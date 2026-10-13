import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

/** Mede-eigenaar = kavelbezitter. De syndicus (Sofie, geen kavel) heeft geen eigenaarsrechten; stemmingen verwijzen naar documenten. */
describe("Mede-eigenaarschap volgt uit kavels; documentreferenties bij stemmingen", () => {
  let synd: Client, marie: Client, jan: Client, ahmed: Client; let meetingId = "";
  beforeAll(async () => {
    [synd, marie, jan, ahmed] = await Promise.all(["syndicus", "marie", "jan", "ahmed"].map(as));
    meetingId = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV kaveltest", type: "av", starts_at: new Date(Date.now() + 25 * 86400_000).toISOString(), notify: false })).data.id;
  });

  it("/me geeft per gebouw het aantal kavels; Sofie heeft er geen, Ahmed één", async () => {
    const s = (await synd.get("/api/auth/me")).data.buildings.find((b: any) => b.id === B); expect(s.units).toBe(0);
    const a = (await ahmed.get("/api/auth/me")).data.buildings.find((b: any) => b.id === B); expect(a.units).toBe(1);
  });

  it("syndicus zonder kavel kan geen aanwezigheid melden of volmacht geven; mede-eigenaars wel", async () => {
    expect((await synd.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "attending" })).status).toBe(403);
    expect((await synd.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: "u-jan" })).status).toBe(403);
    expect((await ahmed.put(`/api/buildings/${B}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: "u-jan" })).status).toBe(200);
  });

  it("volmachtkandidaten zijn enkel kavelbezitters, nooit de syndicus", async () => {
    const ids = (await marie.get(`/api/buildings/${B}/meetings/${meetingId}/proxy-candidates`)).data.map((r: any) => r.user_id);
    expect(ids).toContain("u-jan"); expect(ids).toContain("u-ahmed"); expect(ids).not.toContain("u-syndicus"); expect(ids).not.toContain("u-lotte");
  });

  it("syndicus kan niet stemmen in een eigenaarsstemming en kan geen AV eisen; agenderen mag wel", async () => {
    const pid = (await synd.post(`/api/buildings/${B}/polls`, { title: "Enkel eigenaars", options: ["a", "b"] })).data.id;
    const p = (await synd.get(`/api/buildings/${B}/polls/${pid}`)).data; expect(p.can_vote).toBe(false); expect(p.eligible_voters).toBe(3);
    expect((await synd.post(`/api/buildings/${B}/polls/${pid}/vote`, { option_ids: [p.options[0].id] })).status).toBe(403);
    expect((await ahmed.get(`/api/buildings/${B}/polls/${pid}`)).data.can_vote).toBe(true);
    expect((await synd.post(`/api/buildings/${B}/meeting-requests`, { subject: "x" })).status).toBe(403);
    expect((await synd.post(`/api/buildings/${B}/agenda`, { title: "Door de syndicus geagendeerd", meeting_id: meetingId })).status).toBe(201);
  });

  it("stemming met documentreferenties: aanmaken, tonen, wijzigen, vreemd document geweigerd", async () => {
    const up = await synd.upload(`/api/buildings/${B}/documents`, { category: "offerte", visibility: "all" }, { name: "offerte-dak.pdf", content: "%PDF-1.4\n%%EOF", type: "application/pdf" }); expect(up.status).toBe(201); const docId = up.data.id as string;
    const pid = (await synd.post(`/api/buildings/${B}/polls`, { title: "Offerte dak", options: ["Ja", "Nee"], document_ids: [docId] })).data.id;
    const seen = (await marie.get(`/api/buildings/${B}/polls/${pid}`)).data; expect(seen.documents.map((d: any) => d.id)).toEqual([docId]); expect(seen.documents[0].name).toBe("offerte-dak.pdf");
    expect((await synd.patch(`/api/buildings/${B}/polls/${pid}`, { document_ids: ["bestaat-niet"] })).status).toBe(400);
    expect((await synd.patch(`/api/buildings/${B}/polls/${pid}`, { document_ids: [] })).status).toBe(200);
    expect((await marie.get(`/api/buildings/${B}/polls/${pid}`)).data.documents).toEqual([]);
    expect((await marie.patch(`/api/buildings/${B}/polls/${pid}`, { document_ids: [docId] })).status).toBe(403);
  });
});
