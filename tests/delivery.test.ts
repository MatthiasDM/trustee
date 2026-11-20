import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/worker/lib/delivery";
// @ts-expect-error gewoon JavaScript zonder types
import { checkProduction, parseJsonc } from "../scripts/check-production.mjs";

const SECRET = "whsec_" + Buffer.from("geheim-voor-de-test").toString("base64");
const sign = (id: string, ts: string, body: string, secret = SECRET) => "v1," + createHmac("sha256", Buffer.from(secret.replace("whsec_", ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

describe("Webhook-handtekening (Svix / Standard Webhooks)", () => {
  const at = 1_800_000_000_000; const ts = String(at / 1000); const body = JSON.stringify({ type: "email.bounced", data: { email_id: "x" } });
  it("aanvaardt een geldige handtekening, ook tussen andere handtekeningen (sleutelrotatie)", async () => {
    expect(await verifyWebhook(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, at)).toBe(true);
    expect(await verifyWebhook(SECRET, { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sign("msg_1", ts, body)}` }, body, at)).toBe(true);
  });
  it("weigert een gewijzigde inhoud, een ander geheim, een ander id en ontbrekende headers", async () => {
    const sig = sign("msg_1", ts, body);
    expect(await verifyWebhook(SECRET, { id: "msg_1", timestamp: ts, signature: sig }, body + " ", at)).toBe(false);
    expect(await verifyWebhook("whsec_" + Buffer.from("ander").toString("base64"), { id: "msg_1", timestamp: ts, signature: sig }, body, at)).toBe(false);
    expect(await verifyWebhook(SECRET, { id: "msg_2", timestamp: ts, signature: sig }, body, at)).toBe(false);
    expect(await verifyWebhook(SECRET, { id: null, timestamp: ts, signature: sig }, body, at)).toBe(false);
    expect(await verifyWebhook(SECRET, { id: "msg_1", timestamp: ts, signature: "geen-handtekening" }, body, at)).toBe(false);
  });
  it("weigert een bericht van meer dan vijf minuten oud (replay)", async () => {
    expect(await verifyWebhook(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, at + 6 * 60_000)).toBe(false);
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
});
