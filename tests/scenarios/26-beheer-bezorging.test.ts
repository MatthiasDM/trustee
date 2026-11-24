import { describe, expect, it } from "vitest";
import { B, BASE, Client, PW, as, uniq } from "./client";
import { totpCode } from "../../src/worker/lib/totp";

const ENFORCE = { "x-test-enforce-2fa": "1" }; // de testomgeving draait in demomodus; deze header dwingt de 2FA-plicht af zoals in productie
/** Een bezorgmelding van Cloudflare Email Service, zoals de queue ze aflevert (in de testomgeving via /api/admin/email-event). */
async function emailEvent(kind: string, payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/admin/email-event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: `cf.email.sending.message.${kind}`, payload }) });
  return { status: res.status, data: await res.json() as any };
}

describe("Tweestapsverificatie verplicht voor wie een gebouw beheert", () => {
  it("syndicus zonder 2FA wordt geweigerd met code totp_required; een mede-eigenaar niet", async () => {
    const s = await as("syndicus"); s.headers = ENFORCE;
    const r = await s.get(`/api/buildings/${B}`); expect(r.status).toBe(403); expect(r.data.code).toBe("totp_required");
    expect((await s.get("/api/auth/me")).data.security.totp_required).toBe(true);
    const m = await as("jan"); m.headers = ENFORCE; // Jan zit in de raad maar beheert geen gebouw; Marie wordt in eerdere scenario's elders syndicus
    expect((await m.get(`/api/buildings/${B}`)).status).toBe(200);
    expect((await m.get("/api/auth/me")).data.security.totp_required).toBe(false);
  });
  it("nieuw kantoor: geen gebouw zonder 2FA; na inschakelen wel, en uitschakelen kan dan niet meer", async () => {
    const c = new Client("kantoor"); c.headers = ENFORCE;
    expect((await c.post("/api/auth/register", { name: "Nieuwe Syndicus", email: uniq("syn") + "@t.be", password: PW, orgName: "Kantoor 2FA", accept_terms: true })).status).toBe(200);
    const me = (await c.get("/api/auth/me")).data; expect(me.security.totp_required).toBe(true);
    const building = { name: "Residentie 2FA", address: "Teststraat 1", total_shares: 1000, org_id: me.orgs[0].id };
    const refused = await c.post("/api/buildings", building); expect(refused.status).toBe(403); expect(refused.data.code).toBe("totp_required");
    expect((await c.get(`/api/orgs/${me.orgs[0].id}/overview`)).status).toBe(403);
    const setup = await c.post("/api/auth/totp/setup"); expect(setup.status).toBe(200);
    expect((await c.post("/api/auth/totp/enable", { code: await totpCode(setup.data.secret) })).status).toBe(200);
    const created = await c.post("/api/buildings", building); expect(created.status).toBe(201);
    expect((await c.get(`/api/buildings/${created.data.id}`)).status).toBe(200);
    const off = await c.post("/api/auth/totp/disable", { password: PW, code: await totpCode(setup.data.secret) }); expect(off.status).toBe(400); expect(off.data.error).toMatch(/verplicht/);
  });
});

describe("Platformbeheer: toegang tot een gebouw wordt gelogd", () => {
  it("inzage één keer per uur, elke wijziging apart; zichtbaar voor syndicus en raad", async () => {
    const p = await as("platform"); const j = await as("jan");
    const count = async (action: string) => (await j.get(`/api/buildings/${B}/audit`)).data.filter((a: any) => a.action === action && a.user_id === "u-platform").length;
    const reads = await count("platform.access"); const writes = await count("platform.write");
    expect((await p.get(`/api/buildings/${B}`)).status).toBe(200); expect((await p.get(`/api/buildings/${B}/members`)).status).toBe(200);
    expect(await count("platform.access")).toBeLessThanOrEqual(reads + 1); expect(await count("platform.access")).toBeGreaterThanOrEqual(1);
    expect((await p.patch(`/api/buildings/${B}/members/u-marie`, { postal_address: "Zeedijk 1, 8400 Oostende" })).status).toBe(200);
    expect(await count("platform.write")).toBe(writes + 1);
    const entry = (await j.get(`/api/buildings/${B}/audit`)).data.find((a: any) => a.action === "platform.write"); expect(JSON.parse(entry.meta).path).toContain("/members/u-marie");
    // met de 2FA-plicht aan komt ook platformbeheer er niet in zonder tweede factor
    p.headers = ENFORCE; expect((await p.get(`/api/buildings/${B}`)).data.code).toBe("totp_required");
  });
});

describe("Bounces en aangetekende zendingen", () => {
  let meetingId = ""; let providerId = "";
  it("onbekende of onvolledige meldingen veranderen niets", async () => {
    expect((await emailEvent("opened", { recipient: "marie@demo.be" })).data.status).toBeNull();
    const r = await fetch(`${BASE}/api/admin/email-event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "cf.email.sending.message.bounced" }) });
    expect((await r.json() as any).flagged).toEqual([]);
  });
  it("een bounce markeert het lid, verwittigt de syndicus en maakt de oproeping aangetekend", async () => {
    const s = await as("syndicus");
    await s.patch(`/api/buildings/${B}/members/u-marie`, { ecomm_consent_at: "2026-01-10", postal_address: null }); // marie stemde in met elektronische oproeping
    const title = uniq("Bezorgtest");
    expect((await s.post(`/api/buildings/${B}/broadcast`, { title, body: "Test van de bezorging" })).status).toBe(200);
    const log = (await s.get(`/api/buildings/${B}/deliveries`)).data.find((e: any) => e.subject === title && e.to_email === "marie@demo.be");
    expect(log.status).toBe("sent"); providerId = log.provider_id;
    // tijdelijke bounce (volle mailbox): gelogd, lid niet gemarkeerd
    const soft = await emailEvent("bounced", { messageId: providerId, recipient: "marie@demo.be", bounce: { type: "soft", classification: "temporary_failure", reason: "452 4.2.2 Mailbox full" } });
    expect(soft.status).toBe(200); expect(soft.data.flagged).toEqual([]);
    const before = (await s.get("/api/notifications")).data.items.filter((n: any) => n.type === "delivery").length;
    const hard = await emailEvent("bounced", { messageId: providerId, recipient: "marie@demo.be", bounce: { type: "hard", classification: "permanent_failure", reason: "550 5.1.1 mailbox bestaat niet" } });
    expect(hard.data.flagged).toEqual(["u-marie"]);
    expect((await emailEvent("bounced", { messageId: providerId, recipient: "marie@demo.be", bounce: { type: "hard" } })).data.flagged).toEqual([]); // geen tweede melding
    expect((await s.get("/api/notifications")).data.items.filter((n: any) => n.type === "delivery").length).toBe(before + 1);
    const marie = (await s.get(`/api/buildings/${B}/members`)).data.members.find((m: any) => m.user_id === "u-marie");
    expect(marie.email_bounced_at).toBeTruthy(); expect(marie.email_bounce_reason).toContain("mailbox bestaat niet");
    expect((await s.get(`/api/buildings/${B}/deliveries`)).data.find((e: any) => e.provider_id === providerId).status).toBe("bounced");
    // een gewone mede-eigenaar ziet de bezorgstatus van anderen niet
    // Ahmed is na scenario 04 commissaris: tijdelijk terug gewoon eigenaar, want raad en commissaris zien de status wel
    const ahmedRole = (await s.get(`/api/buildings/${B}/members`)).data.members.find((m: any) => m.user_id === "u-ahmed").role;
    await s.patch(`/api/buildings/${B}/members/u-ahmed`, { role: "eigenaar" });
    const a = await as("ahmed"); expect((await a.get(`/api/buildings/${B}/members`)).data.members.find((m: any) => m.user_id === "u-marie").email_bounced_at).toBeUndefined();
    expect((await a.get(`/api/buildings/${B}/deliveries`)).status).toBe(403);
    await s.patch(`/api/buildings/${B}/members/u-ahmed`, { role: ahmedRole });
    const m = await s.post(`/api/buildings/${B}/meetings`, { title: uniq("AV bezorging"), type: "av", starts_at: new Date(Date.now() + 25 * 86400_000).toISOString(), location: "Polyvalente zaal", notify: false }); meetingId = m.data.id;
    const p = (await s.get(`/api/buildings/${B}/meetings/${meetingId}/convene`)).data;
    expect(p.registered_needed).toContain("u-marie"); expect(p.registered_open).toContain("u-marie");
    expect(p.warnings.join(" ")).toMatch(/onbezorgbaar e-mailadres/); expect(p.warnings.join(" ")).toMatch(/Geen postadres/);
  });
  it("aangetekende brieven: PDF per geadresseerde, registratie met barcode, daarna niet meer open", async () => {
    const s = await as("syndicus"); const base = `/api/buildings/${B}/meetings/${meetingId}/registered`;
    const o = (await s.get(base)).data; const marie = o.needed.find((n: any) => n.user_id === "u-marie"); expect(marie.reason).toBe("bounce"); expect(marie.sent).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    const noAddress = await s.post(base, { user_ids: ["u-marie"], sent_at: today }); expect(noAddress.status).toBe(400); expect(noAddress.data.error).toMatch(/postadres/i);
    await s.patch(`/api/buildings/${B}/members/u-marie`, { postal_address: "Zeedijk 1, 8400 Oostende" });
    const pdf = await s.raw("GET", `${base}/letters.pdf`); expect(pdf.status).toBe(200); expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await s.post(base, { user_ids: ["u-marie"], sent_at: "2999-01-01" })).status).toBe(400); // afgifte in de toekomst
    expect((await s.post(base, { user_ids: ["u-bestaat-niet"], sent_at: today })).status).toBe(400);
    const rec = await s.post(base, { user_ids: ["u-marie"], sent_at: today, tracking: { "u-marie": "010541234567890" } }); expect(rec.status).toBe(200); expect(rec.data.recorded).toBe(1); expect(rec.data.warning).toBeUndefined();
    const after = (await s.get(base)).data.needed.find((n: any) => n.user_id === "u-marie"); expect(after.sent[0].tracking_number).toBe("010541234567890"); expect(after.sent[0].address).toBe("Zeedijk 1, 8400 Oostende");
    const p = (await s.get(`/api/buildings/${B}/meetings/${meetingId}/convene`)).data;
    expect(p.registered_needed).toContain("u-marie"); expect(p.registered_open).not.toContain("u-marie");
    expect(p.warnings.join(" ")).not.toMatch(/onbezorgbaar e-mailadres/);
    expect((await s.patch(`${base}/${after.sent[0].id}`, { delivered_at: today })).status).toBe(200);
    expect((await s.get(`/api/buildings/${B}/audit`)).data.some((x: any) => x.action === "registered.sent")).toBe(true);
    // enkel wie de vergadering beheert
    expect((await (await as("marie")).get(base)).status).toBe(403);
    // notulen aangetekend kan pas als ze definitief zijn
    expect((await s.raw("GET", `${base}/letters.pdf?kind=minutes&all=1`)).status).toBe(400);
  });
  it("een latere geslaagde bezorging wist de markering; de syndicus kan ze ook zelf wissen", async () => {
    const s = await as("syndicus");
    expect((await emailEvent("delivered", { messageId: providerId, recipient: "marie@demo.be", delivery: { status: "delivered" } })).data.cleared).toEqual(["u-marie"]);
    expect((await s.get(`/api/buildings/${B}/members`)).data.members.find((m: any) => m.user_id === "u-marie").email_bounced_at).toBeNull();
    expect((await emailEvent("complained", { recipient: "marie@demo.be" })).data.flagged).toEqual(["u-marie"]); // zonder logboekregel: op adres
    expect((await s.patch(`/api/buildings/${B}/members/u-marie`, { email_bounce_clear: true })).status).toBe(200);
    expect((await s.get(`/api/buildings/${B}/members`)).data.members.find((m: any) => m.user_id === "u-marie").email_bounced_at).toBeNull();
    await s.post(`/api/buildings/${B}/meetings/${meetingId}/cancel`, { reason: "testvergadering" }).catch(() => {});
    await s.del(`/api/buildings/${B}/meetings/${meetingId}`);
  });
});
