import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateRecoveryCodes, totpCode, verifyTotp } from "../src/worker/lib/totp";

describe("TOTP (RFC 6238)", () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890")); // testvector uit de RFC
  it("berekent de referentiecodes uit RFC 6238 (SHA-1, 6 cijfers)", async () => {
    expect(await totpCode(secret, 59_000)).toBe("287082");
    expect(await totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(await totpCode(secret, 1_234_567_890_000)).toBe("005924");
  });
  it("aanvaardt een code uit de vorige of volgende stap, weigert verder weg of ongeldig", async () => {
    const t = 1_234_567_890_000;
    expect(await verifyTotp(secret, await totpCode(secret, t - 30_000), t)).toBe(true);
    expect(await verifyTotp(secret, await totpCode(secret, t + 30_000), t)).toBe(true);
    expect(await verifyTotp(secret, await totpCode(secret, t - 90_000), t)).toBe(false);
    expect(await verifyTotp(secret, "12345", t)).toBe(false);
  });
  it("base32 is omkeerbaar en herstelcodes zijn uniek", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
    const codes = generateRecoveryCodes(); expect(new Set(codes).size).toBe(8); expect(codes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });
});
