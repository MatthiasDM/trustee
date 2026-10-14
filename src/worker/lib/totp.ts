/** TOTP (RFC 6238) met HMAC-SHA1 via WebCrypto; 6 cijfers, stap van 30 s, venster ±1. Geen externe afhankelijkheden. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export function generateSecret(): string { return base32Encode(crypto.getRandomValues(new Uint8Array(20))); }

async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); let c = counter; for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg as BufferSource));
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}
export async function totpCode(secretB32: string, at = Date.now(), step = 30): Promise<string> { return hotp(base32Decode(secretB32), Math.floor(at / 1000 / step)); }
/** Verifieert een code binnen een venster van ±1 stap (klokafwijking). Constante-tijdvergelijking is hier niet nodig: de code is kortlevend en rate-limited. */
export async function verifyTotp(secretB32: string, code: string, at = Date.now()): Promise<boolean> {
  const c = code.replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return false;
  for (const d of [0, -1, 1]) if (await totpCode(secretB32, at + d * 30_000) === c) return true;
  return false;
}
export function otpauthUrl(issuer: string, account: string, secret: string) { return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`; }

/** Herstelcodes: 8 codes van 10 tekens; enkel de SHA-256-hash wordt bewaard. */
export function generateRecoveryCodes(n = 8): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; const out: string[] = [];
  for (let i = 0; i < n; i++) { const r = crypto.getRandomValues(new Uint8Array(10)); out.push([...r].map((x) => alphabet[x % alphabet.length]).join("").replace(/(.{5})(.{5})/, "$1-$2")); }
  return out;
}
export async function sha256Hex(s: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
