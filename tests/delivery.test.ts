import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAddress } from "../src/worker/lib/email";
// @ts-expect-error gewoon JavaScript zonder types
import { checkProduction, parseJsonc } from "../scripts/check-production.mjs";

describe("Afzenderadres voor Cloudflare Email Service", () => {
  it("splitst naam en adres, en laat een kaal adres ongemoeid", () => {
    expect(parseAddress("Trustee <noreply@m-dm.org>")).toEqual({ name: "Trustee", email: "noreply@m-dm.org" });
    expect(parseAddress('"Trustee (demo)" <noreply@example.com>')).toEqual({ name: "Trustee (demo)", email: "noreply@example.com" });
    expect(parseAddress("noreply@m-dm.org")).toBe("noreply@m-dm.org");
    expect(parseAddress("<noreply@m-dm.org>")).toBe("noreply@m-dm.org");
  });
});

describe("Controle van de productieconfiguratie", () => {
  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
  const filled = () => JSON.parse(JSON.stringify(config).replace(/REPLACE_WITH_DOMAIN/g, "trustee.example").replace(/REPLACE_WITH_[A-Z_]+/g, "abc123"));
  it("de productie-omgeving bewaart documenten in de EU, heeft een cron en staat niet in demomodus", () => {
    const p = config.env.production;
    expect(p.r2_buckets.every((b: any) => b.jurisdiction === "eu")).toBe(true);
    expect(p.vars.DEMO_MODE).toBe("0");
    expect(p.triggers.crons.length).toBeGreaterThan(0);
  });
  it("weigert zolang er placeholders staan en aanvaardt een ingevulde configuratie", () => {
    if (JSON.stringify(config.env.production).includes("REPLACE_")) expect(checkProduction(config).join(" ")).toMatch(/placeholders/);
    expect(checkProduction(filled())).toEqual([]);
  });
  it("weigert een bucket buiten de EU, demomodus en http", () => {
    const c = filled(); delete c.env.production.r2_buckets[0].jurisdiction; c.env.production.vars.DEMO_MODE = "1"; c.env.production.vars.APP_URL = "http://trustee.example";
    const errors = checkProduction(c).join(" ");
    expect(errors).toMatch(/jurisdiction/); expect(errors).toMatch(/DEMO_MODE/); expect(errors).toMatch(/https/);
  });
  it("weigert productie zonder Cloudflare Access of met een workers.dev-adres", () => {
    const c = filled(); delete c.env.production.vars.ACCESS_AUD; c.env.production.workers_dev = true;
    const errors = checkProduction(c).join(" ");
    expect(errors).toMatch(/Cloudflare Access/); expect(errors).toMatch(/workers_dev/);
    const d = filled(); d.env.production.vars.ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";
    expect(checkProduction(d).join(" ")).toMatch(/ACCESS_TEAM_DOMAIN/);
  });
  it("weigert productie zonder e-mailbinding, met een ander afzenderadres of zonder queue voor bezorgmeldingen", () => {
    const c = filled(); delete c.env.production.send_email; delete c.env.production.queues;
    const errors = checkProduction(c).join(" ");
    expect(errors).toMatch(/send_email/); expect(errors).toMatch(/queue/);
    const d = filled(); d.env.production.vars.EMAIL_FROM = "Trustee <iemand@elders.be>";
    expect(checkProduction(d).join(" ")).toMatch(/allowed_sender_addresses/);
  });
});
