import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAccessJwt } from "../src/worker/lib/access";

const TEAM = "voorbeeld.cloudflareaccess.com"; const AUD = "aud-van-de-toepassing"; const NOW = 1_800_000_000_000;
const pair = () => { const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }); return { privateKey, jwk: publicKey.export({ format: "jwk" }) as JsonWebKey }; };
const a = pair(); const b = pair();
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (claims: Record<string, unknown>, key = a.privateKey, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }) => {
  const body = `${enc(header)}.${enc(claims)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key).toString("base64url")}`;
};
const claims = (over: Record<string, unknown> = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], exp: NOW / 1000 + 600, email: "iemand@example.com", ...over });
const keys = async () => [{ ...a.jwk, kid: "k1" }];
const check = (t: string | null, team = TEAM) => verifyAccessJwt(t, team, AUD, NOW, keys);

describe("Cloudflare Access-token", () => {
  it("aanvaardt een geldig token van het eigen team en de eigen toepassing", async () => {
    expect((await check(token(claims())))?.email).toBe("iemand@example.com");
    expect(await check(token(claims({ aud: AUD })))).not.toBeNull();
  });
  it("weigert een ontbrekend of misvormd token", async () => {
    for (const t of [null, "", "abc", "a.b.c", token(claims()).split(".").slice(0, 2).join(".")]) expect(await check(t)).toBeNull();
  });
  it("weigert een andere toepassing, een ander team, een verlopen token en een andere sleutel", async () => {
    expect(await check(token(claims({ aud: ["andere"] })))).toBeNull();
    expect(await check(token(claims({ iss: "https://ander.cloudflareaccess.com" })))).toBeNull();
    expect(await check(token(claims({ exp: NOW / 1000 - 1 })))).toBeNull();
    expect(await check(token(claims({ exp: undefined })))).toBeNull();
    expect(await check(token(claims(), b.privateKey))).toBeNull();
    expect(await check(token(claims(), a.privateKey, { alg: "RS256", kid: "onbekend" }))).toBeNull();
  });
  it("weigert een token zonder handtekening (alg none) en een gewijzigde inhoud", async () => {
    expect(await check(`${enc({ alg: "none", kid: "k1" })}.${enc(claims())}.`)).toBeNull();
    const [h, , s] = token(claims()).split(".");
    expect(await check(`${h}.${enc(claims({ email: "ander@example.com" }))}.${s}`)).toBeNull();
  });
});
