import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as, uniq } from "./client";

/** Volmacht aan een derde (art. 3.87 §7 BW): de lasthebber is "al dan niet lid van de algemene vergadering"; de volmacht vermeldt zijn naam. */
describe("Volmacht aan iemand van buiten de mede-eigendom", () => {
  let synd: Client, marie: Client, jan: Client; let base = ""; const NAME = "Meester An De Wolf";
  const rsvp = (c: Client, body: unknown) => c.put(`${base}/rsvp`, body);
  beforeAll(async () => {
    [synd, marie, jan] = await Promise.all(["syndicus", "marie", "jan"].map(as));
    const m = await synd.post(`/api/buildings/${B}/meetings`, { title: uniq("AV volmacht derde"), type: "av", starts_at: new Date(Date.now() + 25 * 86400_000).toISOString() });
    base = `/api/buildings/${B}/meetings/${m.data.id}`;
  });

  it("de naam is verplicht; de syndicus, jezelf en een lid van het gebouw kan je niet op naam invullen", async () => {
    expect((await rsvp(marie, { status: "proxy" })).status).toBe(400);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "An" })).data.error).toMatch(/naam van de lasthebber/);
    const me = await synd.get("/api/auth/me"); const syndName: string = me.data.user?.name ?? me.data.name;
    expect((await rsvp(marie, { status: "proxy", proxy_name: syndName.toUpperCase() })).data.error).toMatch(/syndicus mag geen volmachten dragen/);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "marie  claes" })).data.error).toMatch(/jezelf/);
    expect((await rsvp(marie, { status: "proxy", proxy_name: "Jan Peeters" })).data.error).toMatch(/kies hem of haar in de lijst/);
  });

  it("een derde op naam vertegenwoordigt de kavel: aanwezig voor het quorum, zichtbaar in de lijsten en de notulen", async () => {
    expect((await rsvp(marie, { status: "proxy", proxy_name: NAME })).status).toBe(200);
    const att = (await synd.get(`${base}/attendance`)).data;
    const rows = att.rows.filter((r: any) => r.voter_id === "u-marie"); expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) { expect(r.status).toBe("proxy"); expect(r.present).toBe(true); expect(r.holder_name).toBe(NAME); expect(r.holder_id).toBe("ext:meester an de wolf"); expect(r.remote).toBe(false); }
    expect((await synd.get(`${base}/rsvps`)).data.find((r: any) => r.status === "proxy").proxy_name).toBe(NAME);
    const g = await synd.post(`${base}/minutes/generate`); expect(g.data.body).toContain(`vertegenwoordigd bij volmacht door ${NAME}`);
  });

  it("dezelfde derde wordt herkend ongeacht hoofdletters; een derde tekent niet in de app", async () => {
    expect((await rsvp(jan, { status: "proxy", proxy_name: "  meester AN de wolf " })).status).toBe(200);
    const att = (await synd.get(`${base}/attendance`)).data;
    expect(new Set(att.rows.filter((r: any) => r.status === "proxy").map((r: any) => r.holder_id))).toEqual(new Set(["ext:meester an de wolf"]));
    await synd.post(`${base}/minutes/generate`);
    const signers = (await synd.get(`${base}/minutes/signatures`)).data.signers; expect(signers.some((s: any) => String(s.user_id).startsWith("ext:"))).toBe(false);
    // terug naar een lid: de naam verdwijnt
    expect((await rsvp(jan, { status: "attending" })).status).toBe(200);
    expect((await synd.get(`${base}/attendance`)).data.rows.filter((r: any) => r.voter_id === "u-jan").every((r: any) => r.status === "attending" && !r.holder_id)).toBe(true);
  });

  it("stemming: de kavels van de volmachtgever tellen mee via de derde, die onder het stemplafond valt", async () => {
    const a = await synd.post(`/api/buildings/${B}/agenda`, { title: uniq("Punt volmacht derde"), required_majority: "simple" });
    await synd.patch(`/api/buildings/${B}/agenda/${a.data.id}`, { meeting_id: base.split("/").pop() });
    const present = (await synd.get(`${base}/attendance`)).data.rows.filter((r: any) => r.present);
    const v = await synd.post(`${base}/agenda/${a.data.id}/vote`, { votes: present.map((r: any) => ({ unit_id: r.unit_id, choice: r.voter_id === "u-marie" ? "against" : "for" })), dry_run: true });
    expect(v.status).toBe(200); expect(v.data.voters_against).toBe(present.filter((r: any) => r.voter_id === "u-marie").length);
    for (const c of v.data.capped) expect(c.name).not.toMatch(/^ext:/); // een plafond op de derde toont zijn naam, niet de sleutel
  });

  it("een huurder met account kan volmachtdrager zijn; de kandidatenlijst bevat elk lid behalve de syndicus", async () => {
    const ids = (await marie.get(`${base}/proxy-candidates`)).data.map((r: any) => r.user_id);
    expect(ids).toContain("u-lotte"); expect(ids).toContain("u-jan"); expect(ids).not.toContain("u-syndicus"); expect(ids).not.toContain("u-marie");
    expect((await rsvp(marie, { status: "proxy", proxy_user_id: "u-lotte" })).status).toBe(200);
    expect((await synd.get(`${base}/attendance`)).data.rows.find((r: any) => r.voter_id === "u-marie").holder_id).toBe("u-lotte");
    expect((await rsvp(marie, { status: "proxy", proxy_user_id: "u-syndicus" })).status).toBe(400);
  });
});
