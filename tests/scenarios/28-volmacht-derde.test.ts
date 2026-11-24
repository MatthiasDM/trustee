import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as, uniq } from "./client";

/**
 * Volmacht aan een derde (art. 3.87 §7 BW): de lasthebber is "al dan niet lid van de algemene vergadering"; de volmacht vermeldt zijn naam.
 * Een derde krijgt een tijdelijk account als volmachtdrager, zodat voor hem geen andere beperkingen gelden dan de wettelijke.
 */
describe("Volmacht aan iemand van buiten de mede-eigendom", () => {
  let synd: Client, marie: Client, jan: Client, lotte: Client; let mid = ""; let base = ""; let itemId = ""; let holderId = "";
  const NAME = uniq("Meester An De Wolf"); const EMAIL = `${uniq("an.dewolf")}@example.com`.toLowerCase(); const guest = new Client("volmachtdrager");
  const rsvp = (c: Client, body: unknown) => c.put(`${base}/rsvp`, body);
  beforeAll(async () => {
    [synd, marie, jan, lotte] = await Promise.all(["syndicus", "marie", "jan", "lotte"].map(as));
    const m = await synd.post(`/api/buildings/${B}/meetings`, { title: uniq("AV volmacht derde"), type: "av", starts_at: new Date(Date.now() + 25 * 86400_000).toISOString(), remote_allowed: true, remote_url: "https://video.example/derde" });
    mid = m.data.id; base = `/api/buildings/${B}/meetings/${mid}`;
    const a = await synd.post(`/api/buildings/${B}/agenda`, { title: uniq("Punt volmacht derde"), required_majority: "simple" }); itemId = a.data.id;
    await synd.patch(`/api/buildings/${B}/agenda/${itemId}`, { meeting_id: mid });
  });

  it("de naam is verplicht; de syndicus, jezelf en een lid van het gebouw kan je niet op naam invullen", async () => {
    expect((await rsvp(marie, { status: "proxy" })).status).toBe(400);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "An" })).data.error).toMatch(/naam van de lasthebber/);
    const syndName: string = (await synd.get("/api/auth/me")).data.user.name;
    expect((await rsvp(marie, { status: "proxy", proxy_name: syndName.toUpperCase() })).data.error).toMatch(/syndicus mag geen volmachten dragen/);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "Iemand Anders", proxy_email: "syndicus@demo.be" })).data.error).toMatch(/syndicus mag geen volmachten dragen/);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "marie  claes" })).data.error).toMatch(/jezelf/);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "Jan Peeters" })).data.error).toMatch(/kies hem of haar in de lijst/);
  });

  it("een derde zonder e-mailadres krijgt een account op naam: aanwezig voor het quorum, herkend over volmachten heen", async () => {
    const r = await rsvp(marie, { status: "proxy", proxy_name: NAME }); expect(r.status).toBe(200); expect(r.data.external).toBe(true); expect(r.data.invited).toBe(false); holderId = r.data.holder_user_id; expect(holderId).toBeTruthy();
    const again = await rsvp(jan, { status: "proxy", proxy_name: `  ${NAME.toUpperCase()} ` }); expect(again.data.holder_user_id).toBe(holderId); // zelfde persoon, geen tweede account
    const rows = (await synd.get(`${base}/attendance`)).data.rows.filter((x: any) => x.voter_id === "u-marie" || x.voter_id === "u-jan"); expect(rows.length).toBeGreaterThan(1);
    for (const x of rows) { expect(x.status).toBe("proxy"); expect(x.present).toBe(true); expect(x.holder_name).toBe(NAME); expect(x.holder_id).toBe(holderId); expect(x.acting_id).toBe(holderId); }
    const holders = (await synd.get(`/api/buildings/${B}/members`)).data.proxy_holders; expect(holders.find((h: any) => h.user_id === holderId)).toMatchObject({ name: NAME, has_account: false });
    expect((await marie.get(`/api/buildings/${B}/members`)).data.proxy_holders).toEqual([]); // enkel voor wie een vergadering beheert
    expect((await synd.get(`/api/buildings/${B}/members`)).data.members.some((m: any) => m.user_id === holderId)).toBe(false); // geen lid van het gebouw
  });

  it("belangenconflict (art. 3.87 §9) kan ook voor een derde worden vastgelegd: de volmachten die hij draagt tellen dan niet mee", async () => {
    expect((await synd.patch(`/api/buildings/${B}/agenda/${itemId}`, { conflict_user_ids: [holderId], conflict_reason: "Advocaat van de aannemer" })).status).toBe(200);
    const present = (await synd.get(`${base}/attendance`)).data.rows.filter((x: any) => x.present);
    const v = await synd.post(`${base}/agenda/${itemId}/vote`, { votes: present.map((x: any) => ({ unit_id: x.unit_id, choice: "for" })), dry_run: true });
    expect(v.data.excluded.length).toBe(present.filter((x: any) => x.acting_id === holderId).length); expect(v.data.excluded[0].name).toBe(NAME);
    await synd.patch(`/api/buildings/${B}/agenda/${itemId}`, { conflict_user_ids: [], conflict_reason: null });
  });

  it("met een e-mailadres krijgt dezelfde derde een uitnodiging, kiest een wachtwoord en ziet enkel zijn vergadering", async () => {
    const r = await rsvp(jan, { status: "proxy", proxy_name: NAME, proxy_email: EMAIL }); expect(r.status).toBe(200); expect(r.data.holder_user_id).toBe(holderId); expect(r.data.invited).toBe(true); expect(r.data.invite_token).toBeTruthy();
    expect((await synd.get(`/api/buildings/${B}/members`)).data.proxy_holders.find((h: any) => h.user_id === holderId).has_account).toBe(true);
    expect((await new Client().post("/api/auth/reset-password", { token: r.data.invite_token, password: "volmacht-wachtwoord-1" })).status).toBe(200);
    await guest.login(EMAIL, "volmacht-wachtwoord-1");
    const me = (await guest.get("/api/auth/me")).data; expect(me.buildings.find((x: any) => x.id === B).role).toBe("volmachtdrager"); expect(me.security.totp_required).toBe(false);
    const list = await guest.get(`/api/buildings/${B}/meetings`); expect(list.status).toBe(200); expect(list.data.map((m: any) => m.id)).toEqual([mid]); expect(list.data[0].my_proxies).toBe(2);
    expect((await guest.get(`/api/buildings/${B}/agenda?meeting=${mid}`)).status).toBe(200);
    expect((await guest.get(`${base}/attendance`)).data.rows).toHaveLength(0); // enkel de telling, geen namen
    for (const p of ["", "/documents", "/members", "/posts", "/polls", "/agenda", "/ledger/overview", "/audit", "/meetings/m-1/attendance", `/agenda?meeting=m-1`, `/meetings/${mid}/rsvps`, `/meetings/${mid}/convene`, `/meetings/${mid}/minutes/receipts`])
      expect((await guest.get(`/api/buildings/${B}${p}`)).status, `GET ${p}`).toBe(403);
    expect((await guest.patch(base, { title: "gekaapt" })).status).toBe(403);
    expect((await guest.post(`/api/buildings/${B}/agenda`, { title: "Eigen punt" })).status).toBe(403);
    expect((await guest.post(`/api/buildings/${B}/posts`, { title: "x", body: "y" })).status).toBe(403);
    expect((await guest.post(`${base}/agenda/${itemId}/vote`, { votes: [] })).status).toBe(403);
  });

  it("de derde neemt vanop afstand deel en stemt zelf voor zijn volmachtgevers", async () => {
    expect((await rsvp(guest, { status: "proxy", proxy_user_id: "u-jan" })).status).toBe(400); // hij geeft zelf geen volmacht
    expect((await rsvp(guest, { status: "absent" })).status).toBe(400);
    const r = await rsvp(guest, { status: "remote" }); expect(r.status).toBe(200); expect(r.data.as_holder).toBe(true);
    expect((await guest.get(`/api/buildings/${B}/meetings`)).data[0].remote_url).toBe("https://video.example/derde");
    const mine = (await synd.get(`${base}/attendance`)).data.rows.filter((x: any) => x.acting_id === holderId); expect(mine.every((x: any) => x.remote)).toBe(true);
    expect((await synd.post(`${base}/agenda/${itemId}/ballot/open`)).status).toBe(200);
    const b = await guest.put(`${base}/agenda/${itemId}/ballot`, { choice: "against" }); expect(b.status).toBe(200); expect(b.data.units.length).toBe(mine.length);
    const present = (await synd.get(`${base}/attendance`)).data.rows.filter((x: any) => x.present);
    const v = await synd.post(`${base}/agenda/${itemId}/vote`, { votes: present.map((x: any) => ({ unit_id: x.unit_id, choice: "for" })) });
    expect(v.status).toBe(200); expect(v.data.voters_against).toBe(mine.length); expect(v.data.decision).toMatch(/Vanop afstand gestemd/);
    for (const c of v.data.capped) expect(c.name).toBe(NAME); // het stemplafond geldt ook voor de derde, met zijn naam
    // terug ter plaatse: geen eigen aanmelding meer
    expect((await rsvp(guest, { status: "attending" })).status).toBe(200);
    expect((await synd.get(`${base}/attendance`)).data.rows.filter((x: any) => x.acting_id === holderId).some((x: any) => x.remote)).toBe(false);
  });

  it("de derde tekent de notulen, in de app of op papier", async () => {
    await synd.patch(base, { chair_user_id: "u-jan", secretary_user_id: "u-marie", notify: false });
    const g = await synd.post(`${base}/minutes/generate`); expect(g.data.body).toContain(`vertegenwoordigd bij volmacht door ${NAME}`);
    const s = (await guest.get(`${base}/minutes/signatures`)).data; expect(s.can_sign).toBe(true); expect(s.my_capacity).toBe("owner"); expect(s.body).toContain(NAME);
    expect((await guest.post(`${base}/minutes/sign`, { hash: s.hash })).status).toBe(200);
    expect((await guest.del(`${base}/minutes/signatures/${holderId}`)).status).toBe(200);
    expect((await synd.post(`${base}/minutes/signatures/paper`, { user_ids: [holderId] })).status).toBe(200); // handgeschreven, geregistreerd door de syndicus
    expect((await synd.get(`${base}/minutes/signatures`)).data.signers.find((x: any) => x.user_id === holderId).method).toBe("paper");
  });

  it("de toegang is tijdelijk: ze vervalt met de definitieve notulen en met het intrekken van de volmacht", async () => {
    const f = await synd.post(`${base}/minutes/finalize`, { unsigned_reason: "Voorzitter en secretaris gaven een volmacht en waren niet aanwezig." }); expect(f.status).toBe(200);
    const html = await (await synd.raw("GET", `/api/buildings/${B}/documents/${f.data.documentId}/download?inline=1`)).text(); expect(html).toContain(`${NAME}, mede-eigenaar of lasthebber: handgeschreven getekend`);
    expect((await guest.get(`/api/buildings/${B}/meetings`)).status).toBe(403);
    expect((await guest.get("/api/auth/me")).data.buildings.some((x: any) => x.id === B)).toBe(false);
    // nieuwe vergadering, nieuwe volmacht aan het bestaande account (herkend aan het e-mailadres): opnieuw toegang, tot ze wordt ingetrokken
    const m2 = await synd.post(`/api/buildings/${B}/meetings`, { title: uniq("AV volmacht derde 2"), type: "av", starts_at: new Date(Date.now() + 40 * 86400_000).toISOString() });
    const base2 = `/api/buildings/${B}/meetings/${m2.data.id}`;
    const r = await marie.put(`${base2}/rsvp`, { status: "proxy", proxy_name: "An De Wolf (zelfde persoon)", proxy_email: EMAIL }); expect(r.status).toBe(200); expect(r.data.holder_user_id).toBe(holderId); expect(r.data.invited).toBe(false);
    expect((await guest.get(`/api/buildings/${B}/meetings`)).data.map((m: any) => m.id)).toEqual([m2.data.id]);
    expect((await guest.get("/api/notifications")).data.items.some((n: any) => /Volmacht/.test(n.title))).toBe(true);
    expect((await marie.put(`${base2}/rsvp`, { status: "attending" })).status).toBe(200);
    expect((await guest.get(`/api/buildings/${B}/meetings`)).status).toBe(403);
  });

  it("een huurder met account kan volmachtdrager zijn en kiest dan zelf ter plaatse of vanop afstand", async () => {
    const m3 = await synd.post(`/api/buildings/${B}/meetings`, { title: uniq("AV volmacht huurder"), type: "av", starts_at: new Date(Date.now() + 45 * 86400_000).toISOString(), remote_allowed: true, remote_url: "https://video.example/huurder" });
    const base3 = `/api/buildings/${B}/meetings/${m3.data.id}`;
    const ids = (await marie.get(`${base3}/proxy-candidates`)).data.map((x: any) => x.user_id);
    expect(ids).toContain("u-lotte"); expect(ids).toContain("u-jan"); expect(ids).not.toContain("u-syndicus"); expect(ids).not.toContain("u-marie");
    expect((await lotte.put(`${base3}/rsvp`, { status: "remote" })).status).toBe(403); // draagt (nog) geen volmacht
    expect((await marie.put(`${base3}/rsvp`, { status: "proxy", proxy_user_id: "u-lotte" })).status).toBe(200);
    expect((await marie.put(`${base3}/rsvp`, { status: "proxy", proxy_user_id: "u-syndicus" })).status).toBe(400);
    expect((await lotte.put(`${base3}/rsvp`, { status: "remote" })).status).toBe(200);
    const row = (await synd.get(`${base3}/attendance`)).data.rows.find((x: any) => x.voter_id === "u-marie"); expect(row.holder_id).toBe("u-lotte"); expect(row.remote).toBe(true);
    // volmacht ingetrokken: de aanmelding vanop afstand van de huurder verdwijnt mee
    expect((await marie.put(`${base3}/rsvp`, { status: "attending" })).status).toBe(200);
    expect((await synd.get(`${base3}/rsvps`)).data.some((x: any) => x.email === "lotte@demo.be")).toBe(false);
  });
});
