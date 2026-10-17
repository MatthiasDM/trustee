import { describe, expect, it } from "vitest";
import { B, BASE, as } from "./client";

/** Bezorging van de notulen (art. 3.87 §12): ontvangst per stemgerechtigde, melding "niet ontvangen", herinnering na 30 dagen. */
describe("Ontvangst van de notulen", () => {
  it("definitief maken registreert bezorging; openen wordt geteld; niet ontvangen melden; herinnering bij laattijdige notulen", async () => {
    const synd = await as("syndicus"); const jan = await as("jan"); const marie = await as("marie"); const lotte = await as("lotte");
    const mid = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV ontvangsttest", type: "av", starts_at: new Date(Date.now() - 5 * 86400_000).toISOString() })).data.id;
    await synd.post(`/api/buildings/${B}/meetings/${mid}/minutes/generate`);
    const f = await synd.post(`/api/buildings/${B}/meetings/${mid}/minutes/finalize`); expect(f.status).toBe(200);
    let r = (await synd.get(`/api/buildings/${B}/meetings/${mid}/minutes/receipts`)).data;
    expect(r.total).toBeGreaterThanOrEqual(3); expect(r.opened).toBe(0); expect(r.late).toBe(false);
    expect(r.rows.some((x: any) => x.name === "Lotte De Smet")).toBe(false); // huurder is niet stemgerechtigd
    await jan.raw("GET", `/api/buildings/${B}/documents/${f.data.documentId}/download`);
    r = (await synd.get(`/api/buildings/${B}/meetings/${mid}/minutes/receipts`)).data; expect(r.rows.find((x: any) => x.name === "Jan Peeters").opened_at).toBeTruthy(); expect(r.opened).toBe(1);
    expect((await marie.post(`/api/buildings/${B}/meetings/${mid}/minutes/not-received`)).status).toBe(200);
    expect((await lotte.post(`/api/buildings/${B}/meetings/${mid}/minutes/not-received`)).status).toBe(403);
    expect((await synd.get("/api/notifications")).data.items.some((n: any) => /Notulen niet ontvangen: AV ontvangsttest/.test(n.title))).toBe(true);
    expect((await marie.get(`/api/buildings/${B}/meetings`)).data.find((m: any) => m.id === mid).my_minutes_missing).toBeTruthy();
    expect((await marie.get(`/api/buildings/${B}/meetings/${mid}/minutes/receipts`)).status).toBe(403);
    // laattijdig: vergadering 40 dagen geleden zonder definitieve notulen → één herinnering
    const late = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV zonder notulen", type: "av", starts_at: new Date(Date.now() - 40 * 86400_000).toISOString() })).data.id;
    await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" }); await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" });
    expect((await synd.get("/api/notifications")).data.items.filter((n: any) => n.title === "Notulen te laat: AV zonder notulen").length).toBe(1);
    expect(late).toBeTruthy();
  });
});
