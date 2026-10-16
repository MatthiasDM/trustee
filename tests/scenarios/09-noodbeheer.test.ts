import { beforeAll, describe, expect, it } from "vitest";
import { B, BASE, Client, as } from "./client";

/** Noodbeheer: voorlopig syndicus (art. 3.89 §6-§8) en bijeenroeping door mede-eigenaars (art. 3.87 §2, lid 3-4). */
describe("Voorlopig syndicus", () => {
  let synd: Client, jan: Client, marie: Client, ahmed: Client;
  beforeAll(async () => { [synd, jan, marie, ahmed] = await Promise.all(["syndicus", "jan", "marie", "ahmed"].map(as)); });

  it("raad registreert een voorlopig syndicus (vonnis); die krijgt syndicusrechten tot het einde van het mandaat", async () => {
    expect((await marie.patch(`/api/buildings/${B}`, { name: "Residentie Zeezicht" })).status).toBe(403);
    expect((await jan.post(`/api/buildings/${B}/mandates`, { organ: "voorlopig_syndicus", user_id: "u-marie", start_date: "2026-01-01", end_date: "2027-01-01" })).status).toBe(400); // rechtsgrond verplicht
    expect((await jan.post(`/api/buildings/${B}/mandates`, { organ: "voorlopig_syndicus", holder_name: "Extern", basis: "rechter", start_date: "2026-01-01", end_date: "2027-01-01" })).status).toBe(400); // moet lid zijn
    const r = await jan.post(`/api/buildings/${B}/mandates`, { organ: "voorlopig_syndicus", user_id: "u-marie", basis: "rechter", scope: "Dagelijks beheer tot de volgende AV", start_date: "2026-01-01", end_date: "2027-01-01" });
    expect(r.status).toBe(201);
    const me = (await marie.get("/api/auth/me")).data.buildings.find((x: any) => x.id === B); expect(me.role).toBe("syndicus"); expect(me.acting).toBe(1);
    expect((await marie.patch(`/api/buildings/${B}`, { name: "Residentie Zeezicht" })).status).toBe(200);
    expect((await marie.get(`/api/buildings/${B}/members`)).data.members.find((m: any) => m.user_id === "u-marie").role).toBe("eigenaar"); // rol zelf ongewijzigd
    const organs = (await ahmed.get(`/api/buildings/${B}/organs`)).data; expect(organs.syndicus.some((m: any) => /Marie Claes \(voorlopig syndicus, door de rechter\)/.test(m.name))).toBe(true); expect(organs.syndicus_present).toBe(true);
    // mandaat verstreken → rechten weg
    expect((await synd.patch(`/api/buildings/${B}/mandates/${r.data.id}`, { end_date: "2026-01-02" })).status).toBe(200);
    expect((await marie.patch(`/api/buildings/${B}`, { name: "Residentie Zeezicht" })).status).toBe(403);
    expect((await marie.get("/api/auth/me")).data.buildings.find((x: any) => x.id === B).role).toBe("eigenaar");
  });
});

describe("Mede-eigenaars roepen zelf bijeen", () => {
  let synd: Client, jan: Client, marie: Client, ahmed: Client, lotte: Client;
  beforeAll(async () => { [synd, jan, marie, ahmed, lotte] = await Promise.all(["syndicus", "jan", "marie", "ahmed", "lotte"].map(as)); });

  it("na 30 dagen zonder gevolg mag een ondertekenaar zelf bijeenroepen en die vergadering volledig beheren", async () => {
    expect((await marie.post(`/api/buildings/${B}/meetings`, { title: "Poging tot plannen", type: "av", starts_at: new Date(Date.now() + 20 * 86400_000).toISOString() })).status).toBe(403);
    const req = await marie.post(`/api/buildings/${B}/meeting-requests`, { subject: "Lekkende dakgoot bespreken" }); expect(req.status).toBe(201);
    const s = await jan.post(`/api/buildings/${B}/meeting-requests/${req.data.id}/sign`); expect(s.data.reached).toBe(true);
    let list = (await marie.get(`/api/buildings/${B}/meeting-requests`)).data; expect(list.find((r: any) => r.id === req.data.id).can_convene).toBe(false);
    expect((await fetch(`${BASE}/api/admin/age-request/${req.data.id}`, { method: "POST" })).status).toBe(200);
    list = (await marie.get(`/api/buildings/${B}/meeting-requests`)).data; const r1 = list.find((r: any) => r.id === req.data.id); expect(r1.can_convene).toBe(true); expect(r1.convene_basis).toMatch(/30 dagen/);
    expect((await ahmed.get(`/api/buildings/${B}/meeting-requests`)).data.find((r: any) => r.id === req.data.id).can_convene).toBe(false); // geen ondertekenaar
    // (Lotte: huurder, nooit een grond; Ahmed kan in andere testbestanden tijdelijk een orgaanrol krijgen)
    expect((await lotte.post(`/api/buildings/${B}/meetings`, { title: "Poging tot plannen", type: "av", starts_at: new Date(Date.now() + 20 * 86400_000).toISOString() })).status).toBe(403);
    const m = await marie.post(`/api/buildings/${B}/meetings`, { title: "BAV dakgoot", type: "bav", starts_at: new Date(Date.now() + 20 * 86400_000).toISOString(), location: "Inkomhal" }); expect(m.status).toBe(201);
    const mt = (await lotte.get(`/api/buildings/${B}/meetings`)).data.find((x: any) => x.id === m.data.id);
    expect(mt.convened_by_owners).toBe(1); expect(mt.legal_basis).toMatch(/3\.87 §2, lid 3/); expect(mt.created_by_name).toBe("Marie Claes"); expect(mt.can_manage).toBe(false);
    expect((await marie.get(`/api/buildings/${B}/meetings`)).data.find((x: any) => x.id === m.data.id).can_manage).toBe(true);
    // verzoek ingewilligd door Marie zelf, onderwerp op de agenda
    const done = (await marie.get(`/api/buildings/${B}/meeting-requests`)).data.find((r: any) => r.id === req.data.id); expect(done.status).toBe("fulfilled"); expect(done.fulfilled_meeting_id).toBe(m.data.id);
    const agenda = (await marie.get(`/api/buildings/${B}/agenda?meeting=${m.data.id}`)).data.items; expect(agenda.some((i: any) => i.title === "Lekkende dakgoot bespreken" && i.status === "scheduled")).toBe(true);
    // Marie beheert: agenderen, oproepen, aanwezigheden, stemming registreren, notulen; Ahmed niet
    const extra = await marie.post(`/api/buildings/${B}/agenda`, { title: "Offerte dakwerker", meeting_id: m.data.id }); expect(extra.status).toBe(201);
    expect((await marie.get(`/api/buildings/${B}/agenda?meeting=${m.data.id}`)).data.items.find((i: any) => i.id === extra.data.id).status).toBe("scheduled");
    expect((await marie.get(`/api/buildings/${B}/meetings/${m.data.id}/convene`)).status).toBe(200);
    expect((await lotte.get(`/api/buildings/${B}/meetings/${m.data.id}/convene`)).status).toBe(403);
    expect((await marie.post(`/api/buildings/${B}/meetings/${m.data.id}/convene`, { acknowledge: true })).status).toBe(200);
    expect((await marie.get(`/api/buildings/${B}/meetings/${m.data.id}/attendance`)).data.rows.length).toBeGreaterThan(0);
    expect((await lotte.get(`/api/buildings/${B}/meetings/${m.data.id}/attendance`)).data.rows.length).toBe(0);
    const item = agenda.find((i: any) => i.title === "Lekkende dakgoot bespreken");
    expect((await marie.post(`/api/buildings/${B}/meetings/${m.data.id}/agenda/${item.id}/vote`, { votes: [{ unit_id: "un-a1", choice: "for" }, { unit_id: "un-a2", choice: "for" }, { unit_id: "un-a3", choice: "against" }, { unit_id: "un-g1", choice: "for" }, { unit_id: "un-g2", choice: "for" }] })).status).toBe(200);
    expect((await marie.post(`/api/buildings/${B}/meetings/${m.data.id}/minutes/generate`)).status).toBe(200);
    expect((await lotte.post(`/api/buildings/${B}/meetings/${m.data.id}/minutes/finalize`)).status).toBe(403);
    expect((await marie.post(`/api/buildings/${B}/meetings/${m.data.id}/minutes/finalize`)).status).toBe(200);
    // andere vergaderingen blijft ze niet beheren
    const other = (await synd.get(`/api/buildings/${B}/meetings`)).data.find((x: any) => x.id !== m.data.id && !x.cancelled_at);
    if (other) expect((await marie.get(`/api/buildings/${B}/meetings/${other.id}/convene`)).status).toBe(403);
  });

  it("verzoek 'syndicus aanwijzen' krijgt de 30-dagentermijn zolang er een syndicus is", async () => {
    const req = await ahmed.post(`/api/buildings/${B}/meeting-requests`, { subject: "Nieuwe syndicus", purpose: "appoint_syndicus" }); expect(req.status).toBe(201);
    const s = await jan.post(`/api/buildings/${B}/meeting-requests/${req.data.id}/sign`); expect(s.data.reached).toBe(true);
    const r = (await ahmed.get(`/api/buildings/${B}/meeting-requests`)).data.find((x: any) => x.id === req.data.id);
    expect(r.purpose).toBe("appoint_syndicus"); expect(r.syndicus_present).toBe(true); expect(r.can_convene).toBe(false); expect(r.deadline > new Date().toISOString().slice(0, 10)).toBe(true);
    await ahmed.patch(`/api/buildings/${B}/meeting-requests/${req.data.id}`, { status: "cancelled" });
  });
});
