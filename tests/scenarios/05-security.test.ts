import { describe, expect, it } from "vitest";
import { B, BASE, Client, as, uniq } from "./client";

describe("Beveiliging: rate limiting, uploads, sessies", () => {
  it("blokkeert na 10 foute logins op hetzelfde account, andere accounts blijven werken", async () => {
    const email = uniq("brute") + "@t.be"; let last = 0;
    for (let i = 0; i < 11; i++) last = (await new Client().post("/api/auth/login", { email, password: "x" })).status;
    expect(last).toBe(429);
    expect((await new Client().post("/api/auth/login", { email: "marie@demo.be", password: "wachtwoord123" })).status).toBe(200);
  });
  it("weigert uitvoerbare bestanden, html en dubbele extensies; laat pdf toe", async () => {
    const s = await as("syndicus");
    expect((await s.upload(`/api/buildings/${B}/documents`, {}, { name: "virus.exe", content: "x" })).status).toBe(415);
    expect((await s.upload(`/api/buildings/${B}/documents`, {}, { name: "pagina.html", content: "<script>", type: "text/html" })).status).toBe(415);
    expect((await s.upload(`/api/buildings/${B}/documents`, {}, { name: "factuur.pdf.exe", content: "x" })).status).toBe(415);
    const ok = await s.upload(`/api/buildings/${B}/documents`, { category: "factuur" }, { name: "factuur.pdf", content: "%PDF-1.4 test", type: "application/pdf" }); expect(ok.status).toBe(201);
    const dl = await s.raw("GET", `/api/buildings/${B}/documents/${ok.data.id}/download?inline=1`); expect(dl.headers.get("x-content-type-options")).toBe("nosniff"); expect(dl.headers.get("content-type")).toBe("application/pdf");
  });
  it("sessie: afmelden maakt de cookie ongeldig; wachtwoordwijziging vereist het huidige", async () => {
    const m = await as("marie"); expect((await m.get("/api/auth/me")).data.user.email).toBe("marie@demo.be");
    expect((await m.post("/api/auth/change-password", { current: "fout", next: "nieuwwachtwoord" })).status).toBe(400);
    await m.post("/api/auth/logout"); expect((await m.get("/api/auth/me")).data.user).toBeNull();
    expect((await m.get(`/api/buildings/${B}`)).status).toBe(401);
  });
  it("wachtwoord vergeten lekt niet of een account bestaat", async () => {
    expect((await new Client().post("/api/auth/forgot-password", { email: "bestaatniet@t.be" })).status).toBe(200);
    expect((await new Client().post("/api/auth/reset-password", { token: "ongeldig", password: "nieuwwachtwoord" })).status).toBe(400);
  });
  it("raad die een syndicus-document opent, triggert één kennisgeving per dag", async () => {
    const s = await as("syndicus"); const j = await as("jan");
    const d = await s.upload(`/api/buildings/${B}/documents`, { visibility: "syndicus" }, { name: `intern-${uniq("d")}.txt`, content: "x", type: "text/plain" });
    const before = (await s.get("/api/notifications")).data.items.filter((n: any) => n.type === "inspection").length;
    await j.raw("GET", `/api/buildings/${B}/documents/${d.data.id}/download`); await j.raw("GET", `/api/buildings/${B}/documents/${d.data.id}/download`);
    const after = (await s.get("/api/notifications")).data.items.filter((n: any) => n.type === "inspection").length;
    expect(after - before).toBe(1);
    expect((await (await as("marie")).raw("GET", `/api/buildings/${B}/documents/${d.data.id}/download`)).status).toBe(404);
  });
  it("mandaten: syndicus > 3 jaar en huurder in de raad worden geweigerd", async () => {
    const s = await as("syndicus");
    expect((await s.post(`/api/buildings/${B}/mandates`, { organ: "syndicus", holder_name: "X", start_date: "2026-01-01", end_date: "2030-01-01" })).status).toBe(400);
    expect((await s.post(`/api/buildings/${B}/mandates`, { organ: "raad", user_id: "u-lotte", start_date: "2026-01-01", end_date: "2027-01-01" })).status).toBe(400);
  });
  it("cron draait zonder fouten en registreert zijn status (enkel in de testomgeving aanroepbaar)", async () => {
    const r = await fetch(`${BASE}/api/admin/run-cron`, { method: "POST" }); expect(r.status).toBe(200);
    const log = await r.json(); expect(log.ok).toBe(true);
    const s = await as("syndicus"); const b = await s.get(`/api/buildings/${B}/backups`); expect(b.data.last_cron?.ok).toBe(true);
  });
});

describe("Tweestapsverificatie", () => {
  it("activeren met geldige code, aanmelden vereist tweede stap, herstelcode werkt één keer, uitschakelen", async () => {
    const { totpCode } = await import("../../src/worker/lib/totp");
    const c = await as("lotte");
    const setup = (await c.post("/api/auth/totp/setup")).data; expect(setup.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect((await c.post("/api/auth/totp/enable", { code: "000000" })).status).toBe(400);
    const en = await c.post("/api/auth/totp/enable", { code: await totpCode(setup.secret) }); expect(en.status).toBe(200); expect(en.data.recovery_codes).toHaveLength(8);
    expect((await c.get("/api/auth/me")).data.security.totp_enabled).toBe(true);
    const fresh = new Client();
    const l1 = await fresh.post("/api/auth/login", { email: "lotte@demo.be", password: "wachtwoord123" }); expect(l1.data.totp_required).toBe(true);
    expect((await fresh.get("/api/auth/me")).data.user).toBeNull(); // nog geen sessie
    expect((await fresh.post("/api/auth/login/totp", { challenge: l1.data.challenge, code: "123456" })).status).toBe(401);
    expect((await fresh.post("/api/auth/login/totp", { challenge: l1.data.challenge, code: await totpCode(setup.secret) })).status).toBe(200);
    expect((await fresh.get("/api/auth/me")).data.user.email).toBe("lotte@demo.be");
    const again = new Client(); const l2 = await again.post("/api/auth/login", { email: "lotte@demo.be", password: "wachtwoord123" });
    expect((await again.post("/api/auth/login/totp", { challenge: l2.data.challenge, code: en.data.recovery_codes[0] })).status).toBe(200);
    const third = new Client(); const l3 = await third.post("/api/auth/login", { email: "lotte@demo.be", password: "wachtwoord123" });
    expect((await third.post("/api/auth/login/totp", { challenge: l3.data.challenge, code: en.data.recovery_codes[0] })).status).toBe(401); // al gebruikt
    const out = await c.post("/api/auth/logout-all"); expect(out.data.ended).toBeGreaterThanOrEqual(2);
    expect((await fresh.get("/api/auth/me")).data.user).toBeNull();
    expect((await c.post("/api/auth/totp/disable", { password: "fout", code: await totpCode(setup.secret) })).status).toBe(401);
    expect((await c.post("/api/auth/totp/disable", { password: "wachtwoord123", code: await totpCode(setup.secret) })).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { email: "lotte@demo.be", password: "wachtwoord123" })).data.ok).toBe(true);
  });
});
