import { beforeAll, describe, expect, it } from "vitest";
import { B, BASE, Client, as } from "./client";

/** Handelingen met rechtsgevolg vereisen een bewuste, gelogde handeling: oproeping, annulering, herinneringen. */
describe("Oproeping, annulering en akkoord elektronische communicatie", () => {
  let synd: Client, marie: Client, jan: Client; let soon = ""; let later = "";
  beforeAll(async () => {
    [synd, marie, jan] = await Promise.all(["syndicus", "marie", "jan"].map(as));
    soon = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV te vroeg", type: "av", starts_at: new Date(Date.now() + 5 * 86400_000).toISOString() })).data.id;
    later = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV op tijd", type: "av", starts_at: new Date(Date.now() + 40 * 86400_000).toISOString() })).data.id;
  });

  it("plannen verstuurt niets; het voorbeeld waarschuwt voor termijn, lege agenda en ontbrekend akkoord", async () => {
    const list = (await marie.get(`/api/buildings/${B}/meetings`)).data; expect(list.find((m: any) => m.id === soon).convened_at).toBeNull();
    const p = (await synd.get(`/api/buildings/${B}/meetings/${soon}/convene`)).data;
    expect(p.days_until).toBeLessThan(15); expect(p.warnings.join(" ")).toMatch(/15 dagen/); expect(p.warnings.join(" ")).toMatch(/agenda/i); expect(p.warnings.join(" ")).toMatch(/aangetekend/);
    expect(p.recipients.some((r: any) => r.user_id === "u-marie")).toBe(true);
    expect((await synd.post(`/api/buildings/${B}/meetings/${soon}/convene`, {})).status).toBe(400); // zonder bevestiging
    expect((await marie.get(`/api/buildings/${B}/meetings/${soon}/convene`)).status).toBe(403);
  });

  it("lid geeft akkoord voor elektronische oproeping; syndicus registreert schriftelijk akkoord; voorbeeld telt mee", async () => {
    expect((await marie.patch(`/api/buildings/${B}/me/preferences`, { ecomm_consent: true })).status).toBe(200);
    expect((await marie.get(`/api/buildings/${B}/me/preferences`)).data.ecomm_consent_via).toBe("app");
    expect((await synd.patch(`/api/buildings/${B}/members/u-jan`, { ecomm_consent_at: "2026-09-01" })).status).toBe(200);
    const members = (await synd.get(`/api/buildings/${B}/members`)).data.members;
    expect(members.find((m: any) => m.user_id === "u-jan").ecomm_consent_via).toBe("written");
    const p = (await synd.get(`/api/buildings/${B}/meetings/${later}/convene`)).data;
    expect(p.registered_needed).not.toContain("u-marie"); expect(p.registered_needed).not.toContain("u-jan"); expect(p.registered_needed).toContain("u-ahmed");
    await marie.patch(`/api/buildings/${B}/me/preferences`, { ecomm_consent: false });
    expect((await marie.get(`/api/buildings/${B}/me/preferences`)).data.ecomm_consent_at).toBeNull();
  });

  it("oproeping met bevestiging wordt gelogd; datum wijzigen zet oproeping terug en verwittigt; verwijderen geweigerd, annuleren met reden", async () => {
    await synd.post(`/api/buildings/${B}/agenda`, { title: "Punt voor AV op tijd", meeting_id: later });
    const r = await synd.post(`/api/buildings/${B}/meetings/${later}/convene`, { acknowledge: true }); expect(r.status).toBe(200); expect(r.data.recipients).toBeGreaterThan(3);
    const m1 = (await jan.get(`/api/buildings/${B}/meetings`)).data.find((m: any) => m.id === later); expect(m1.convened_at).toBeTruthy(); expect(m1.convened_by_name).toBe("Sofie Vermeulen");
    expect((await jan.get("/api/notifications")).data.items.some((n: any) => /Oproeping: AV op tijd/.test(n.title))).toBe(true);
    await synd.patch(`/api/buildings/${B}/meetings/${later}`, { starts_at: new Date(Date.now() + 45 * 86400_000).toISOString() });
    const m2 = (await jan.get(`/api/buildings/${B}/meetings`)).data.find((m: any) => m.id === later); expect(m2.convened_at).toBeNull();
    expect((await jan.get("/api/notifications")).data.items.some((n: any) => /Gewijzigd: AV op tijd/.test(n.title))).toBe(true);
    await synd.post(`/api/buildings/${B}/meetings/${later}/convene`, { acknowledge: true });
    expect((await synd.del(`/api/buildings/${B}/meetings/${later}`)).status).toBe(400); // opgeroepen: annuleren i.p.v. verwijderen
    expect((await synd.post(`/api/buildings/${B}/meetings/${later}/cancel`, { reason: "x" })).status).toBe(400); // reden te kort
    expect((await synd.post(`/api/buildings/${B}/meetings/${later}/cancel`, { reason: "Per vergissing ingepland" })).status).toBe(200);
    const m3 = (await jan.get(`/api/buildings/${B}/meetings`)).data.find((m: any) => m.id === later); expect(m3.cancelled_at).toBeTruthy(); expect(m3.cancel_reason).toBe("Per vergissing ingepland");
    expect((await jan.get("/api/notifications")).data.items.some((n: any) => /Geannuleerd: AV op tijd/.test(n.title))).toBe(true);
    expect((await synd.get(`/api/buildings/${B}/agenda?meeting=none`)).data.items.some((i: any) => i.title === "Punt voor AV op tijd" && i.status === "proposed")).toBe(true);
    expect((await marie.put(`/api/buildings/${B}/meetings/${later}/rsvp`, { status: "attending" })).status).toBe(400);
    const audit = (await synd.get(`/api/buildings/${B}/audit`)).data; expect(audit.some((a: any) => a.action === "meeting.convene")).toBe(true); expect(audit.some((a: any) => a.action === "meeting.cancel")).toBe(true);
    expect((await synd.del(`/api/buildings/${B}/meetings/${soon}`)).status).toBe(200); // nooit opgeroepen: mag weg
  });
});

describe("Betalingsopvolging: voorstellen in plaats van automatisch versturen", () => {
  it("cron maakt een voorstel; syndicus verstuurt of wijst af; niets wordt zonder goedkeuring verstuurd", async () => {
    const synd = await as("syndicus");
    await synd.patch(`/api/buildings/${B}`, { reminder_auto: true, reminder_days_1: 1 });
    const before = (await synd.get(`/api/buildings/${B}/ledger/overdue`)).data;
    if (!before.units.length) return; // geen vervallen voorschotten in deze seed: niets te testen
    const histBefore = before.history.length;
    const r = await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" }); expect(r.status).toBe(200);
    const after = (await synd.get(`/api/buildings/${B}/ledger/overdue`)).data;
    expect(after.history.length).toBe(histBefore); // niets verstuurd
    const open = after.proposals.filter((p: any) => before.units.some((u: any) => u.unit_id === p.unit_id && !u.last_level));
    expect(open.length).toBeGreaterThan(0);
    const first = open[0];
    expect((await synd.post(`/api/buildings/${B}/ledger/reminder-proposals/${first.id}`, { action: "dismiss" })).status).toBe(200);
    expect((await synd.post(`/api/buildings/${B}/ledger/reminder-proposals/${first.id}`, { action: "send" })).status).toBe(404); // al afgehandeld
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    const again = (await synd.get(`/api/buildings/${B}/ledger/overdue`)).data;
    const p2 = again.proposals.find((p: any) => p.unit_id === first.unit_id); expect(p2).toBeTruthy(); // afgewezen → bij de volgende run opnieuw voorgesteld
    expect((await synd.post(`/api/buildings/${B}/ledger/reminder-proposals/${p2.id}`, { action: "send" })).status).toBe(200);
    expect((await synd.get(`/api/buildings/${B}/ledger/overdue`)).data.history.length).toBe(histBefore + 1);
    await synd.patch(`/api/buildings/${B}`, { reminder_auto: false });
  });
});
