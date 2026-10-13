import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, AuthUser } from "../env";
import { HttpError, plusMs, uid } from "./util";

const COOKIE = "trustee_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dagen

export async function createSession(c: Context<AppEnv>, userId: string) {
  const id = uid();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, c.req.header("user-agent") ?? null, plusMs(SESSION_TTL_MS)).run();
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, COOKIE, id, { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: SESSION_TTL_MS / 1000 });
  return id;
}

export async function destroySession(c: Context<AppEnv>) {
  const id = getCookie(c, COOKIE);
  if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function loadUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const id = getCookie(c, COOKIE);
  if (!id) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.locale, u.is_superadmin, u.phone, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  ).bind(id).first<AuthUser & { expires_at: string }>();
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  c.set("sessionId", id);
  const { expires_at: _e, ...user } = row;
  return user;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c);
  if (!user) throw new HttpError(401, "Niet aangemeld");
  c.set("user", user);
  await next();
};

/** Laadt het gebouw uit :buildingId en controleert lidmaatschap (of superadmin / org-admin). */
export const requireBuilding = (...roles: string[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const user = c.get("user");
  const buildingId = c.req.param("buildingId");
  if (!buildingId) throw new HttpError(400, "buildingId ontbreekt");
  const b = await c.env.DB.prepare(
    `SELECT b.id, b.org_id, b.name, b.total_shares,
            COALESCE(bm.role, CASE WHEN om.user_id IS NOT NULL THEN 'syndicus' END) AS role,
            (SELECT COUNT(*) FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE un.building_id = b.id AND uo.user_id = ?1) AS units
     FROM buildings b
     LEFT JOIN building_members bm ON bm.building_id = b.id AND bm.user_id = ?1
     LEFT JOIN org_members om ON om.org_id = b.org_id AND om.user_id = ?1
     WHERE b.id = ?2`
  ).bind(user.id, buildingId).first<{ id: string; org_id: string; name: string; total_shares: number; role: string | null; units: number }>();
  if (!b) throw new HttpError(404, "Gebouw niet gevonden");
  const role = b.role ?? (user.is_superadmin ? "syndicus" : null);
  if (!role) throw new HttpError(403, "Geen toegang tot dit gebouw");
  if (roles.length && !roles.includes(role)) throw new HttpError(403, "Onvoldoende rechten");
  c.set("building", { ...b, role });
  await next();
};

export const isManager = (role: string) => role === "syndicus";
export const isBoard = (role: string) => role === "syndicus" || role === "raad" || role === "commissaris";
/** Rol met inzage in stukken "enkel eigenaars" (alles behalve huurder). Niet gebruiken voor stemrecht: zie isCoOwner. */
export const isOwner = (role: string) => role !== "huurder";
/**
 * Mede-eigenaar in de zin van de wet: wie een kavel bezit. De syndicus of een externe commissaris zonder kavel
 * is géén mede-eigenaar en kan dus niet stemmen, geen volmacht geven, geen agendapunt indienen en geen AV eisen.
 * Een lid met rol eigenaar of raad geldt ook zonder gekoppelde kavel als mede-eigenaar (kavels nog niet toegewezen).
 */
export const isCoOwner = (b: { role: string; units: number }) => b.units > 0 || b.role === "eigenaar" || b.role === "raad";
