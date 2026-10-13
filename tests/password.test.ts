import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/worker/lib/password";

describe("wachtwoordhash", () => {
  it("blijft binnen de PBKDF2-limiet van Cloudflare Workers (100.000 iteraties) en verifieert correct", async () => {
    const h = await hashPassword("geheim123");
    const [algo, iter] = h.split("$");
    expect(algo).toBe("pbkdf2"); expect(Number(iter)).toBeLessThanOrEqual(100000);
    expect(await verifyPassword("geheim123", h)).toBe(true);
    expect(await verifyPassword("fout", h)).toBe(false);
    expect(await verifyPassword("geheim123", "onzin")).toBe(false);
  });
  it("seed-hashes gebruiken dezelfde limiet", async () => {
    const { readFileSync } = await import("node:fs");
    const seed = readFileSync(new URL("../seed/seed.sql", import.meta.url), "utf8");
    for (const m of seed.matchAll(/pbkdf2\$(\d+)\$/g)) expect(Number(m[1])).toBeLessThanOrEqual(100000);
  });
});
