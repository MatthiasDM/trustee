import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as, uniq } from "./client";

/** Deelname vanop afstand (art. 3.87 §1 BW) en ondertekening van de notulen (art. 3.87 §10 BW). */
describe("AV vanop afstand en ondertekening van de notulen", () => {
  let synd: Client, marie: Client, jan: Client, lotte: Client; let mid = ""; let itemId = ""; let base = "";
  let marieUnits: string[] = []; let janUnits: string[] = [];
  beforeAll(async () => { [synd, marie, jan, lotte] = await Promise.all(["syndicus", "marie", "jan", "lotte"].map(as)); });

  it("vanop afstand kan enkel als de vergadering erin voorziet; de link moet https zijn", async () => {
    const m = await synd.post(`/api/buildings/${B}/meetings`, { title: uniq("AV afstand"), type: "av", starts_at: new Date(Date.now() + 25 * 86400_000).toISOString(), location: "Polyvalente zaal" });
    expect(m.status).toBe(201); mid = m.data.id; base = `/api/buildings/${B}/meetings/${mid}`;
    const no = await marie.put(`${base}/rsvp`, { status: "remote" }); expect(no.status).toBe(400); expect(no.data.error).toMatch(/bijeenroeping/);
    expect((await synd.patch(base, { remote_allowed: true, remote_url: "http://onveilig.example/av" })).status).toBe(400);
    expect((await synd.patch(base, { remote_allowed: true, remote_url: "https://video.example/av", remote_info: "Camera aan bij het aanmelden." })).status).toBe(200);
    expect((await marie.patch(base, { remote_allowed: false })).status).toBe(403);
  });

  it("de oproeping vermeldt het; na de oproeping aan- of uitzetten vraagt een nieuwe oproeping", async () => {
    const a = await synd.post(`/api/buildings/${B}/agenda`, { title: uniq("Gevelrenovatie"), required_majority: "simple", meeting_id: mid }); itemId = a.data.id;
    await synd.patch(`/api/buildings/${B}/agenda/${itemId}`, { meeting_id: mid });
    expect((await synd.get(`${base}/convene`)).data.meeting.remote_allowed).toBe(true);
    expect((await synd.post(`${base}/convene`, { acknowledge: true })).status).toBe(200);
    const note = (await marie.get("/api/notifications")).data.items.find((n: any) => n.type === "meeting" && /Oproeping/.test(n.title) && /vanop afstand/.test(n.body ?? ""));
    expect(note).toBeTruthy();
    const pdf = await synd.raw("GET", `${base}/registered/letters.pdf?all=1`); expect(pdf.status).toBe(200);
    const find = async () => (await synd.get(`/api/buildings/${B}/meetings`)).data.find((x: any) => x.id === mid);
    expect((await find()).convened_at).toBeTruthy();
    await synd.patch(base, { remote_allowed: false }); expect((await find()).convened_at).toBeNull();
    await synd.patch(base, { remote_allowed: true }); await synd.post(`${base}/convene`, { acknowledge: true });
    expect((await find()).convened_at).toBeTruthy();
  });

  it("wie zich vanop afstand aanmeldt telt mee voor het quorum; enkel hij en de beheerder zien de link", async () => {
    expect((await marie.put(`${base}/rsvp`, { status: "remote" })).status).toBe(200);
    expect((await jan.put(`${base}/rsvp`, { status: "attending" })).status).toBe(200);
    const att = (await synd.get(`${base}/attendance`)).data;
    marieUnits = att.rows.filter((r: any) => r.acting_id === "u-marie").map((r: any) => r.unit_id); janUnits = att.rows.filter((r: any) => r.acting_id === "u-jan").map((r: any) => r.unit_id);
    expect(marieUnits.length).toBeGreaterThan(0); expect(janUnits.length).toBeGreaterThan(0);
    for (const r of att.rows) { if (marieUnits.includes(r.unit_id)) { expect(r.remote).toBe(true); expect(r.present).toBe(true); } if (janUnits.includes(r.unit_id)) expect(r.remote).toBe(false); }
    const list = async (c: Client) => (await c.get(`/api/buildings/${B}/meetings`)).data.find((x: any) => x.id === mid);
    expect((await list(marie)).remote_url).toBe("https://video.example/av"); expect((await list(jan)).remote_url).toBe("https://video.example/av"); // Jan zit in de raad en beheert mee
    expect((await list(lotte)).remote_url).toBeNull();
    const r = (await marie.get(`${base}/remote`)).data; expect(r.joined).toBe(true); expect(r.url).toBe("https://video.example/av"); expect(r.units.map((u: any) => u.unit_id).sort()).toEqual([...marieUnits].sort());
    expect((await lotte.get(`${base}/remote`)).data.url).toBeNull();
  });

  it("stemronde: pas na openen, enkel wie vanop afstand deelneemt; de eigen stem gaat voor op wat de voorzitter invult", async () => {
    const ballot = `${base}/agenda/${itemId}/ballot`;
    expect((await marie.put(ballot, { choice: "for" })).status).toBe(400); // nog niet open
    expect((await marie.post(`${ballot}/open`)).status).toBe(403);
    expect((await synd.post(`${ballot}/open`)).status).toBe(200);
    const notRemote = await lotte.put(ballot, { choice: "for" }); expect(notRemote.status).toBe(403);
    expect((await marie.put(ballot, { choice: "for" })).status).toBe(200);
    const changed = await marie.put(ballot, { choice: "against" }); expect(changed.status).toBe(200); expect(changed.data.choice).toBe("against");
    const seen = (await synd.get(`${base}/remote`)).data.items.find((i: any) => i.id === itemId); expect(seen.open).toBe(true); expect(seen.cast.map((x: any) => x.unit_id).sort()).toEqual([...marieUnits].sort());
    expect((await marie.get(`${base}/remote`)).data.items.find((i: any) => i.id === itemId).cast).toBeUndefined(); // deelnemers zien elkaars stem niet
    // de voorzitter vult voor iedereen "vóór" in; de kavels van Marie blijven "tegen"
    const all = (await synd.get(`${base}/attendance`)).data.rows.filter((r: any) => r.present).map((r: any) => ({ unit_id: r.unit_id, choice: "for" }));
    const v = await synd.post(`${base}/agenda/${itemId}/vote`, { votes: all }); expect(v.status).toBe(200);
    expect(v.data.voters_against).toBe(marieUnits.length); expect(v.data.dissenters.join(" ")).toContain("Marie"); expect(v.data.decision).toMatch(/Vanop afstand gestemd \(art\. 3\.87 §1 BW\)/);
    expect((await marie.put(ballot, { choice: "for" })).status).toBe(400); // beslissing vastgelegd: ronde gesloten
    expect((await synd.post(`${ballot}/open`)).status).toBe(400);
  });

  it("notulen: definitief maken vraagt de handtekening van voorzitter en secretaris; een gewijzigde tekst doet handtekeningen vervallen", async () => {
    await synd.patch(base, { chair_user_id: "u-jan", secretary_user_id: "u-marie", notify: false });
    const g = await synd.post(`${base}/minutes/generate`); expect(g.status).toBe(200); expect(g.data.body).toContain("aanwezig vanop afstand"); expect(g.data.body).toContain("voorzag in deelname vanop afstand");
    const refused = await synd.post(`${base}/minutes/finalize`); expect(refused.status).toBe(400); expect(refused.data.code).toBe("minutes_unsigned"); expect(refused.data.error).toMatch(/voorzitter tekende nog niet/);
    expect((await synd.post(`${base}/minutes/finalize`, { unsigned_reason: "kort" })).status).toBe(400);
    const sig = `${base}/minutes/signatures`;
    expect((await lotte.get(sig)).status).toBe(403); // huurder: was niet aanwezig als mede-eigenaar
    const s = (await marie.get(sig)).data; expect(s.can_sign).toBe(true); expect(s.my_capacity).toBe("secretary"); expect(s.body).toContain("Gevelrenovatie"); expect(s.hash).toHaveLength(64);
    expect(s.signers.find((x: any) => x.user_id === "u-jan").capacity).toBe("chair"); expect(s.signers.find((x: any) => x.user_id === "u-marie").remote).toBe(true);
    expect((await marie.post(`${base}/minutes/sign`, { hash: "0".repeat(64) })).status).toBe(409);
    expect((await lotte.post(`${base}/minutes/sign`, { hash: s.hash })).status).toBe(403);
    expect((await marie.post(`${base}/minutes/sign`, { hash: s.hash })).status).toBe(200);
    expect((await marie.post(`${sig}/paper`, { user_ids: ["u-jan"] })).status).toBe(403); // enkel wie de vergadering beheert
    expect((await synd.post(`${sig}/paper`, { user_ids: ["u-lotte"] })).status).toBe(400); // staat niet op de aanwezigheidslijst
    expect((await synd.post(`${sig}/paper`, { user_ids: ["u-jan"] })).status).toBe(200);
    expect((await synd.get(sig)).data.missing).toEqual([]);
    // tekst wijzigen: beide handtekeningen vervallen
    const edited = await synd.patch(`${base}/minutes`, { body: g.data.body + "\nVaria: de fietsenstalling wordt opgeruimd." }); expect(edited.data.signatures_reset).toBe(2);
    expect((await synd.get(sig)).data.missing).toHaveLength(2);
    expect((await synd.post(`${base}/minutes/finalize`)).status).toBe(400);
    const s2 = (await jan.get(sig)).data; expect(s2.hash).not.toBe(s.hash);
    expect((await jan.post(`${base}/minutes/sign`, { hash: s2.hash })).status).toBe(200);
    expect((await marie.post(`${base}/minutes/sign`, { hash: s2.hash })).status).toBe(200);
    // eigen handtekening intrekken en opnieuw zetten; die van een ander niet
    expect((await marie.del(`${sig}/u-jan`)).status).toBe(403);
    expect((await marie.del(`${sig}/u-marie`)).status).toBe(200); expect((await synd.get(sig)).data.missing).toEqual(["de secretaris tekende nog niet"]);
    expect((await marie.post(`${base}/minutes/sign`, { hash: s2.hash })).status).toBe(200);
  });

  it("het definitieve document draagt de handtekeningen en het controlegetal; daarna tekent niemand meer", async () => {
    const f = await synd.post(`${base}/minutes/finalize`); expect(f.status).toBe(200); expect(f.data.signatures).toBe(2); expect(f.data.unsigned).toBe(false);
    const html = await (await marie.raw("GET", `/api/buildings/${B}/documents/${f.data.documentId}/download?inline=1`)).text();
    expect(html).toContain("Ondertekening (art. 3.87 §10 BW)"); expect(html).toMatch(/Jan Peeters, voorzitter: elektronisch getekend in Trustee/); expect(html).toMatch(/secretaris: elektronisch getekend/);
    const s = (await synd.get(`${base}/minutes/signatures`)).data; expect(s.status).toBe("final"); expect(html).toContain(s.hash);
    expect((await marie.post(`${base}/minutes/sign`, { hash: s.hash })).status).toBe(400);
    expect((await marie.del(`${base}/minutes/signatures/u-marie`)).status).toBe(400);
    const log = (await synd.get(`/api/buildings/${B}/audit?limit=200`)); if (log.status === 200) { const actions = (log.data.items ?? log.data).map((x: any) => x.action); expect(actions).toContain("minutes.sign"); expect(actions).toContain("minutes.signatures_reset"); }
  });

  it("zonder handtekeningen kan enkel met een reden, die in het document staat", async () => {
    const m = await synd.post(`/api/buildings/${B}/meetings`, { title: uniq("AV zonder handtekening"), type: "av", starts_at: new Date(Date.now() - 2 * 86400_000).toISOString() });
    const b2 = `/api/buildings/${B}/meetings/${m.data.id}`;
    await synd.post(`${b2}/minutes/generate`);
    const f = await synd.post(`${b2}/minutes/finalize`, { unsigned_reason: "De voorzitter verliet de zaal voor het einde van de zitting." }); expect(f.status).toBe(200); expect(f.data.unsigned).toBe(true);
    const html = await (await synd.raw("GET", `/api/buildings/${B}/documents/${f.data.documentId}/download?inline=1`)).text();
    expect(html).toContain("niet ondertekend in Trustee"); expect(html).toContain("De voorzitter verliet de zaal");
  });
});
