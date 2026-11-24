// Controleert de productie-omgeving in wrangler.jsonc vóór een deploy: geen placeholders, opslag in de EU, https, geen demomodus.
// Gebruik: node scripts/check-production.mjs [--secrets]   (--secrets vraagt ook de lijst van secrets op bij Cloudflare)
//          node scripts/check-production.mjs --access    (na de deploy: is het adres afgeschermd met Cloudflare Access?)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** JSONC naar JSON: commentaar weg (buiten strings) en hangende komma's. */
export function parseJsonc(src) {
  let out = "", inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { out += ch; if (ch === "\\") out += src[++i]; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function checkProduction(config) {
  const p = config.env?.production; const errors = [];
  if (!p) return ["env.production ontbreekt in wrangler.jsonc"];
  if (JSON.stringify(p).includes("REPLACE_")) errors.push("Er staan nog REPLACE_-placeholders in env.production (database-id, KV-id, domein, VAPID, Access)");
  if (!p.r2_buckets?.length || p.r2_buckets.some((b) => b.jurisdiction !== "eu")) errors.push('Elke R2-bucket moet "jurisdiction": "eu" hebben');
  if (!/^https:\/\//.test(p.vars?.APP_URL ?? "")) errors.push("APP_URL moet met https:// beginnen");
  if (p.vars?.DEMO_MODE !== "0") errors.push('DEMO_MODE moet "0" zijn: in demomodus is tweestapsverificatie niet verplicht en kan iedereen van gebruiker wisselen');
  if (p.vars?.DEMO_ONLY === "1" || p.vars?.TEST_MODE === "1") errors.push("DEMO_ONLY en TEST_MODE horen niet in productie");
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(p.vars?.ACCESS_TEAM_DOMAIN ?? "") || !p.vars?.ACCESS_AUD) errors.push("ACCESS_TEAM_DOMAIN (<team>.cloudflareaccess.com) en ACCESS_AUD ontbreken: zonder Cloudflare Access is productie voor iedereen bereikbaar");
  if (p.workers_dev !== false) errors.push('"workers_dev" moet false zijn: het workers.dev-adres valt buiten de Access-toepassing');
  if (!p.d1_databases?.length || !p.kv_namespaces?.length) errors.push("D1-database en KV-namespace ontbreken");
  const from = /<([^>]+)>/.exec(p.vars?.EMAIL_FROM ?? "")?.[1] ?? p.vars?.EMAIL_FROM;
  const mail = p.send_email?.find((b) => b.name === "EMAIL");
  if (!mail) errors.push('De send_email-binding "EMAIL" ontbreekt: zonder binding wordt geen enkele e-mail verstuurd (Cloudflare Email Service)');
  else if (mail.allowed_sender_addresses && !mail.allowed_sender_addresses.includes(from)) errors.push(`EMAIL_FROM (${from}) staat niet in allowed_sender_addresses van de send_email-binding`);
  if (!p.queues?.consumers?.length) errors.push("De queue voor bezorgmeldingen ontbreekt: zonder bounces geen aangetekende oproeping voor wie onbereikbaar is");
  if (!p.triggers?.crons?.length) errors.push("De cron ontbreekt: zonder cron geen back-ups, herinneringen of opruiming");
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
  const errors = checkProduction(config);
  if (!errors.length && process.argv.includes("--secrets")) {
    // De waarden zijn niet opvraagbaar; enkel of ze gezet zijn. De jurisdictie van D1 is na aanmaak niet meer te wijzigen: gebruik --jurisdiction eu bij `d1 create`.
    const names = JSON.parse(execSync("npx wrangler secret list --env production --format json", { encoding: "utf8" })).map((s) => s.name);
    for (const s of ["VAPID_PRIVATE_KEY"]) if (!names.includes(s)) errors.push(`Secret ${s} is niet gezet (npx wrangler secret put ${s} --env production)`);
  }
  if (errors.length) { console.error("Productie is niet klaar:\n" + errors.map((e) => `  - ${e}`).join("\n")); process.exit(1); }
  if (process.argv.includes("--access")) {
    // Na de deploy: zonder Access-token moet de API weigeren en de voorpagina naar de aanmelding van Access doorsturen.
    const url = config.env.production.vars.APP_URL;
    const api = await fetch(`${url}/api/health`, { redirect: "manual" });
    const page = await fetch(url, { redirect: "manual" });
    const viaAccess = (r) => [301, 302, 303].includes(r.status) && (r.headers.get("location") ?? "").includes(".cloudflareaccess.com");
    if (api.status === 200) { console.error(`NIET AFGESCHERMD: ${url}/api/health antwoordt zonder Access-token.`); process.exit(1); }
    if (!viaAccess(page)) { console.error(`De voorpagina van ${url} stuurt niet door naar Cloudflare Access (status ${page.status}): de Access-toepassing ontbreekt of dekt dit adres niet. De API weigert wel (status ${api.status}).`); process.exit(1); }
    console.log(`Afgeschermd: ${url} stuurt door naar Cloudflare Access en de API weigert zonder token (status ${api.status}).`);
    process.exit(0);
  }
  console.log("Productieconfiguratie in orde.");
}
