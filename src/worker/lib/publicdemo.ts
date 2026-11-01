import type { MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "../env";
import { HttpError, now } from "./util";

/**
 * Publieke demo-instantie (DEMO_ONLY=1): enkel wegwerp-demo's, met limieten zodat bezoekers de server niet kunnen overbelasten.
 * Zonder DEMO_ONLY verandert hier niets.
 */
export const DEMO_LIMITS = {
  fileBytes: 5 * 1024 * 1024, // per bestand
  jsonBytes: 64 * 1024, // per JSON-aanvraag
  buildingBytes: 25 * 1024 * 1024, // bestanden per demogebouw
  buildingDocuments: 30,
  totalBytes: 1024 * 1024 * 1024, // bestanden over alle demo's samen
  databaseBytes: 500 * 1024 * 1024, // daarboven ruimt de cron de oudste demo's op
  startsPerIpPerDay: 5,
  startsPerDay: 25, // een demo schrijft enkele duizenden rijen; de daglimiet van de database moet ruim blijven
  activeDemos: 100,
};
/** Geen scripts, archieven of video in de publieke demo: enkel wat je nodig hebt om de functies te proberen. */
const DEMO_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp", "docx", "xlsx", "csv", "txt", "cod", "coda"]);

export const isPublicDemo = (env: Pick<Env, "DEMO_ONLY">) => env.DEMO_ONLY === "1";

/** Functies die op de publieke demo niet bestaan: echte accounts, nieuwe tenants, externe push, en wat de KV-daglimiet kan opgebruiken. */
const BLOCKED: RegExp[] = [
  /^\/api\/auth\/(register|login|login\/totp|forgot-password|reset-password|totp\/.+)$/,
  /^\/api\/buildings$/,
  /^\/api\/orgs(\/|$)/,
  /^\/api\/notifications\/push\//,
  /^\/api\/buildings\/[^/]+\/handover(\/|$)/,
  /^\/api\/buildings\/handover(\/|$)/,
];

export const isBlockedInDemo = (method: string, path: string) => !["GET", "HEAD", "OPTIONS"].includes(method) && BLOCKED.some((r) => r.test(path));

/** Grootte van de aanvraag vooraf controleren, zonder de inhoud te lezen. Geeft een foutstatus terug, of null. */
export function bodyTooLarge(method: string, headers: { get(name: string): string | null }): { status: 411 | 413; error: string } | null {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  const raw = headers.get("content-length");
  if (raw === null) return headers.get("transfer-encoding") ? { status: 411, error: "Lengte van de aanvraag ontbreekt" } : null;
  const size = Number(raw);
  const multipart = /^multipart\/form-data/i.test(headers.get("content-type") ?? "");
  if (!Number.isFinite(size) || size > (multipart ? DEMO_LIMITS.fileBytes + 64 * 1024 : DEMO_LIMITS.jsonBytes)) return { status: 413, error: multipart ? "Bestand te groot voor de demo (max 5 MB)" : "Aanvraag te groot" };
  return null;
}

/** Het echte adres komt van de doorstuur-Worker; aanvragen buiten die Worker om worden geweigerd als EDGE_SECRET gezet is. */
const viaEdge = (env: Env, headers: { get(name: string): string | null }) => !!env.EDGE_SECRET && headers.get("x-edge-secret") === env.EDGE_SECRET;
export const clientIp = (env: Env, headers: { get(name: string): string | null }) => (viaEdge(env, headers) && headers.get("x-demo-client-ip")) || headers.get("cf-connecting-ip") || "local";

export const publicDemoGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isPublicDemo(c.env)) return next();
  if (c.env.EDGE_SECRET && !viaEdge(c.env, c.req.raw.headers)) return c.json({ error: "Niet gevonden" }, 404);
  const method = c.req.method; const path = c.req.path;
  if (isBlockedInDemo(method, path)) return c.json({ error: "Niet beschikbaar in de publieke demo" }, 403);
  const tooLarge = bodyTooLarge(method, c.req.raw.headers);
  if (tooLarge) return c.json({ error: tooLarge.error }, tooLarge.status);
  const ip = clientIp(c.env, c.req.raw.headers);
  const limiter = ["GET", "HEAD", "OPTIONS"].includes(method) ? c.env.RL_READ : c.env.RL_WRITE;
  if (limiter && !(await limiter.limit({ key: ip })).success) { c.header("Retry-After", "60"); return c.json({ error: "Te veel aanvragen. Wacht even en probeer opnieuw." }, 429); }
  return next();
};

/** Extra uploadregels van de publieke demo: type, grootte, en opslag per gebouw en in totaal. Oude versie van een document telt niet mee. */
export async function assertDemoUpload(env: Env, buildingId: string, file: File, replacing = 0) {
  if (!isPublicDemo(env)) return;
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!DEMO_EXT.has(ext)) throw new HttpError(415, "In de publieke demo kan je enkel pdf, afbeeldingen, Word, Excel, csv, txt en CODA uploaden");
  if (file.size > DEMO_LIMITS.fileBytes) throw new HttpError(413, "Bestand te groot voor de demo (max 5 MB)");
  const here = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM documents WHERE building_id = ?").bind(buildingId).first<{ n: number; bytes: number }>();
  if (!replacing && (here?.n ?? 0) >= DEMO_LIMITS.buildingDocuments) throw new HttpError(413, `Een demogebouw bevat maximaal ${DEMO_LIMITS.buildingDocuments} documenten`);
  if ((here?.bytes ?? 0) - replacing + file.size > DEMO_LIMITS.buildingBytes) throw new HttpError(413, "De opslag van dit demogebouw is vol (max 25 MB)");
  const all = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM documents").first<{ bytes: number }>();
  if ((all?.bytes ?? 0) + file.size > DEMO_LIMITS.totalBytes) throw new HttpError(503, "De demo-opslag is tijdelijk vol. Probeer later opnieuw.");
}

const hashIp = async (ip: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${new Date().toISOString().slice(0, 10)}:${ip}`)))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");

/** Nieuwe demo toelaten? Per adres en in totaal per dag, en een plafond op het aantal actieve demo's. Het adres wordt enkel gehasht bewaard, 24 u lang. */
export async function assertDemoStart(env: Env, ip: string) {
  if (!isPublicDemo(env)) return;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const hash = await hashIp(ip);
  const [active, total, mine] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM buildings WHERE demo_group IS NOT NULL AND parent_building_id IS NULL"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM demo_starts WHERE at > ?").bind(since),
    env.DB.prepare("SELECT COUNT(*) AS n FROM demo_starts WHERE at > ? AND ip_hash = ?").bind(since, hash),
  ]);
  if ((mine.results[0]?.n ?? 0) >= DEMO_LIMITS.startsPerIpPerDay) throw new HttpError(429, "Je hebt vandaag al enkele demo's gestart. Probeer morgen opnieuw of gebruik je bestaande demo.");
  if ((total.results[0]?.n ?? 0) >= DEMO_LIMITS.startsPerDay || (active.results[0]?.n ?? 0) >= DEMO_LIMITS.activeDemos) throw new HttpError(503, "De demo zit vandaag vol. Probeer morgen opnieuw.");
  await env.DB.prepare("INSERT INTO demo_starts (ip_hash, at) VALUES (?, ?)").bind(hash, now()).run();
}

/** De geplande taak van de publieke demo: opruimen, niets anders (geen back-ups, herinneringen of e-mail). */
export async function publicDemoCron(env: Env, cleanup: (env: Env, max: number) => Promise<number>, removeOldest: (env: Env, n: number) => Promise<number>) {
  const log: Record<string, unknown> = { demos_removed: await cleanup(env, 5) };
  const nowIso = new Date().toISOString();
  const size = (await env.DB.prepare("DELETE FROM demo_starts WHERE at < ?").bind(new Date(Date.now() - 86400_000).toISOString()).run()).meta.size_after ?? 0;
  if (size > DEMO_LIMITS.databaseBytes) log.demos_removed_for_space = await removeOldest(env, 5);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso).run();
  log.db_bytes = size;
  return log;
}
