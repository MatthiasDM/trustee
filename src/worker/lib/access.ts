import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

/**
 * Afscherming met Cloudflare Access: als ACCESS_TEAM_DOMAIN en ACCESS_AUD gezet zijn, aanvaardt de API enkel verzoeken
 * met een geldig Access-token (header Cf-Access-Jwt-Assertion). Zo blijft de instantie gesloten als de Access-toepassing
 * ontbreekt, verkeerd staat of omzeild wordt. De webhook van Resend heeft een eigen handtekening en is uitgezonderd.
 */
type Jwk = JsonWebKey & { kid?: string };
export type KeyFetcher = (teamDomain: string) => Promise<Jwk[]>;

const cache = new Map<string, { at: number; keys: Jwk[] }>();
const fetchKeys: KeyFetcher = async (team) => {
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access-sleutels niet op te halen (${res.status})`);
  return ((await res.json()) as { keys: Jwk[] }).keys ?? [];
};

const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64u(s)));

/** Geeft de claims terug als het token geldig is voor dit team en deze toepassing, anders null. */
export async function verifyAccessJwt(token: string | null | undefined, teamDomain: string, aud: string, nowMs = Date.now(), getKeys: KeyFetcher = fetchKeys): Promise<Record<string, any> | null> {
  try {
    const parts = (token ?? "").split(".");
    if (parts.length !== 3) return null;
    const header = json(parts[0]); const claims = json(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return null;
    let entry = cache.get(teamDomain);
    // sleutels een uur bewaren; bij een onbekende kid (rotatie) opnieuw ophalen
    if (!entry || nowMs - entry.at > 3600_000 || !entry.keys.some((k) => k.kid === header.kid)) { entry = { at: nowMs, keys: await getKeys(teamDomain) }; cache.set(teamDomain, entry); }
    const jwk = entry.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud) || claims.iss !== `https://${teamDomain}`) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return null;
    if (typeof claims.nbf === "number" && claims.nbf * 1000 > nowMs + 60_000) return null;
    return claims;
  } catch { return null; }
}

export const accessGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const team = c.env.ACCESS_TEAM_DOMAIN; const aud = c.env.ACCESS_AUD;
  if (!team || !aud || c.req.path.startsWith("/api/webhooks/")) return next();
  if (!(await verifyAccessJwt(c.req.header("cf-access-jwt-assertion"), team, aud))) return c.json({ error: "Deze instantie is enkel bereikbaar via Cloudflare Access", code: "access_required" }, 403);
  return next();
};
