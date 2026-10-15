// Genereert seed/seed.sql met demo-accounts (wachtwoord: wachtwoord123). De inhoud komt uit seed/template.mjs (ook gebruikt door de demo-modus).
import { webcrypto as crypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { seedSql } from "../seed/template.mjs";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function hash(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${b64u(salt)}$${b64u(bits)}`;
}
const legal = Object.fromEntries([...readFileSync(new URL("../src/shared/legal.ts", import.meta.url), "utf8").matchAll(/(terms|privacy): "([\d-]+)"/g)].map((m) => [m[1], m[2]]));
writeFileSync(new URL("../seed/seed.sql", import.meta.url), seedSql({ hash: await hash("wachtwoord123"), legal }));
console.log("seed.sql geschreven");
