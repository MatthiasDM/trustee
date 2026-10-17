import { beforeAll, describe, expect, it } from "vitest";
import { B, BASE, Client, as } from "./client";

/** Beslissingenregister met termijnen (art. 3.93 §4, 3.92 §1 en §3, 3.93 §5, 3.87 §12). */
describe("Beslissingenregister", () => {
  let synd: Client, marie: Client, lotte: Client;
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  const decide = async (when: string, title: string, opts: { kind?: string; majority?: string; against?: string[] } = {}) => {
    const mid = (await synd.post(`/api/buildings/${B}/meetings`, { title: `AV ${title}`, type: "av", starts_at: when })).data.id;
    const id = (await synd.post(`/api/buildings/${B}/agenda`, { title, meeting_id: mid, kind: opts.kind ?? "general", required_majority: opts.majority ?? "simple" })).data.id;
    const votes = ["un-a1", "un-a2", "un-a3", "un-g1", "un-g2"].map((u) => ({ unit_id: u, choice: opts.against?.includes(u) ? "against" : "for" }));
    expect((await synd.post(`/api/buildings/${B}/meetings/${mid}/agenda/${id}/vote`, { votes })).status).toBe(200);
    return id as string;
  };
  const find = async (c: Client, id: string) => (await c.get(`/api/buildings/${B}/decisions`)).data.items.find((x: any) => x.id === id);
  beforeAll(async () => { [synd, marie, lotte] = await Promise.all(["syndicus", "marie", "lotte"].map(as)); });

  it("oude beslissing is definitief, recente aanvechtbaar tot 4 maanden na de AV; iedereen mag het register inzien", async () => {
    const old = await decide(ago(150), "Register: oude beslissing");
    const fresh = await decide(ago(10), "Register: recente beslissing", { against: ["un-g2"] });
    const o = await find(lotte, old); expect(o.status).toBe("final"); expect(o.adopted).toBe(1);
    const f = await find(lotte, fresh); expect(f.status).toBe("challengeable"); expect(f.status_label).toMatch(/^Aanvechtbaar tot \d{4}-\d{2}-\d{2}$/);
    expect(f.dissenters[0]).toMatch(/Marie Claes \(kavel G2\)/); expect(f.minutes_late).toBe(false);
    const csv = await synd.raw("GET", `/api/buildings/${B}/decisions.csv`); expect(csv.status).toBe(200); expect(await csv.text()).toMatch(/Register: recente beslissing/);
  });

  it("aanvechting registreren: enkel syndicus of raad; status volgt; leden krijgen bericht bij vernietiging", async () => {
    const id = await decide(ago(20), "Register: aangevochten beslissing");
    expect((await marie.patch(`/api/buildings/${B}/decisions/${id}`, { challenge_status: "pending" })).status).toBe(403);
    expect((await synd.patch(`/api/buildings/${B}/decisions/${id}`, { challenge_status: "pending", challenged_at: new Date().toISOString().slice(0, 10), challenge_note: "Vordering eigenaar G2" })).status).toBe(200);
    expect((await find(marie, id)).status).toBe("challenged");
    await synd.patch(`/api/buildings/${B}/decisions/${id}`, { challenge_status: "annulled" });
    expect((await find(marie, id)).status).toBe("annulled");
    expect((await marie.get("/api/notifications")).data.items.some((n: any) => /Beslissing vernietigd: Register: aangevochten/.test(n.title))).toBe(true);
  });

  it("afbraak en heropbouw zonder eenparigheid: geschorst tot vonnis, herinnering vóór de termijn", async () => {
    const id = await decide(ago(105), "Register: afbraak en heropbouw", { kind: "demolition", majority: "four_fifths", against: ["un-g2"] });
    const d = await find(marie, id);
    expect(d.adopted).toBe(1); expect(d.needs_court).toBe(true); expect(d.status).toBe("awaiting_court"); expect(d.execution_suspended).toBe(true);
    expect(d.hints.join(" ")).toMatch(/3\.92 §1/);
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    const n1 = (await synd.get("/api/notifications")).data.items.filter((n: any) => /^Nog \d+ dagen: Register: afbraak en heropbouw/.test(n.title)).length; expect(n1).toBe(1);
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    expect((await synd.get("/api/notifications")).data.items.filter((n: any) => /^Nog \d+ dagen: Register: afbraak en heropbouw/.test(n.title)).length).toBe(1); // geen dubbele herinnering
    await synd.patch(`/api/buildings/${B}/decisions/${id}`, { court_status: "filed" });
    expect((await find(marie, id)).status_label).toMatch(/zaak bij de vrederechter/);
    await synd.patch(`/api/buildings/${B}/decisions/${id}`, { court_status: "approved" });
    const done = await find(marie, id); expect(done.execution_suspended).toBe(false);
    // eenparig: geen procedure nodig
    const un = await decide(ago(30), "Register: eenparige heropbouw", { kind: "demolition", majority: "four_fifths" });
    expect((await find(marie, un)).needs_court).toBe(false);
  });
});
