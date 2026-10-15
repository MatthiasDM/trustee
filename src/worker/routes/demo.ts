import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { createSession, destroySession, loadUser, requireAuth } from "../lib/auth";
import { hashPassword } from "../lib/password";
import { HttpError, now, randomToken } from "../lib/util";
import { audit } from "../lib/notify";
import { LEGAL_VERSIONS } from "../../shared/legal";
import { DEMO_TTL_MS } from "../lib/demo";
export { DEMO_TTL_MS } from "../lib/demo";
// @ts-expect-error JS-module zonder types (gedeeld met scripts/seed.mjs)
import { seedSql } from "../../../seed/template.mjs";

/**
 * Demo-modus (DEMO_MODE=1): iedereen kan met één klik een volledig geseed gebouw aanmaken, met vijf rollen,
 * en met één klik van gebruiker wisselen. Alles wordt verwijderd na 24 u zonder activiteit (cron).
 */
export const demo = new Hono<AppEnv>();
/** Oude sessie (indien aanwezig) uit de database, nieuwe sessie aanmaken; één Set-Cookie (deleteCookie + setCookie samen verwart sommige clients). */
async function replaceSession(c: Context<AppEnv>, userId: string) {
  await loadUser(c);
  const sid = c.get("sessionId");
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  await createSession(c, userId);
}
const guard = (env: AppEnv["Bindings"]) => { if (env.DEMO_MODE !== "1") throw new HttpError(404, "Demo-modus is niet actief"); };

demo.get("/status", async (c) => c.json({ enabled: c.env.DEMO_MODE === "1", ttl_hours: DEMO_TTL_MS / 3600_000 }));

/** Nieuw demo-gebouw: seed met unieke suffix; de bezoeker wordt aangemeld als syndicus. */
demo.post("/start", async (c) => {
  guard(c.env);
  const body = z.object({ name: z.string().min(2).max(80).optional(), address: z.string().max(120).optional(), city: z.string().max(80).optional() }).parse(await c.req.json().catch(() => ({})));
  const sfx = `-d${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
  const sql: string = seedSql({ sfx, hash: await hashPassword(randomToken(12)), legal: LEGAL_VERSIONS, emailDomain: "demo.invalid", building: { name: body.name, address: body.address, city: body.city } });
  // commentaarregels eerst weg (anders verdwijnt het statement dat erop volgt), dan splitsen per statement
  const stmts = sql.replace(/^--.*$/gm, "").split(";\n").map((s) => s.trim()).filter(Boolean);
  await c.env.DB.batch(stmts.map((s) => c.env.DB.prepare(s)));
  const buildingId = `b-zeezicht${sfx}`;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE buildings SET demo_group = ?, demo_last_activity = ? WHERE id = ?").bind(sfx, now(), buildingId),
    c.env.DB.prepare("UPDATE users SET demo_group = ? WHERE id IN (?,?,?,?,?)").bind(sfx, `u-syndicus${sfx}`, `u-jan${sfx}`, `u-marie${sfx}`, `u-ahmed${sfx}`, `u-lotte${sfx}`),
  ]);
  await replaceSession(c, `u-syndicus${sfx}`);
  await audit(c.env, buildingId, `u-syndicus${sfx}`, "demo.start", "building", buildingId);
  return c.json({ buildingId, group: sfx }, 201);
});

/** Gebruikers van dezelfde demo-groep (voor de wisselbalk). */
export async function demoUsers(env: AppEnv["Bindings"], group: string) {
  return (await env.DB.prepare("SELECT u.id, u.name, bm.role, b.id AS building_id, b.demo_last_activity FROM users u JOIN building_members bm ON bm.user_id = u.id JOIN buildings b ON b.id = bm.building_id WHERE u.demo_group = ?1 AND b.demo_group = ?1 ORDER BY CASE bm.role WHEN 'syndicus' THEN 0 WHEN 'raad' THEN 1 WHEN 'commissaris' THEN 2 WHEN 'eigenaar' THEN 3 ELSE 4 END, u.name").bind(group).all()).results as any[];
}

/** Van gebruiker wisselen binnen dezelfde demo-groep: oude sessie weg, nieuwe sessie voor de gekozen gebruiker. */
demo.post("/switch", requireAuth, async (c) => {
  guard(c.env);
  const me = c.get("user") as any;
  const { user_id } = z.object({ user_id: z.string() }).parse(await c.req.json());
  if (!me.demo_group) throw new HttpError(403, "Enkel in een demo");
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND demo_group = ?").bind(user_id, me.demo_group).first();
  if (!target) throw new HttpError(404, "Geen gebruiker van deze demo");
  await replaceSession(c, user_id);
  return c.json({ ok: true });
});

/** Demo nu beëindigen en alles verwijderen. */
demo.post("/end", requireAuth, async (c) => {
  guard(c.env);
  const me = c.get("user") as any;
  if (!me.demo_group) throw new HttpError(403, "Enkel in een demo");
  await destroySession(c);
  await deleteDemoGroup(c.env, me.demo_group);
  return c.json({ ok: true });
});

/** Verwijdert gebouw (cascade), organisatie, gebruikers en bestanden van één demo-groep. */
export async function deleteDemoGroup(env: AppEnv["Bindings"], group: string) {
  const buildings = (await env.DB.prepare("SELECT id, org_id FROM buildings WHERE demo_group = ?").bind(group).all<{ id: string; org_id: string }>()).results;
  for (const b of buildings) {
    let cursor: string | undefined;
    do { const l = await env.DOCS.list({ prefix: `${b.id}/`, cursor }); for (const o of l.objects) await env.DOCS.delete(o.key); cursor = l.truncated ? l.cursor : undefined; } while (cursor);
    const bk = await env.DOCS.list({ prefix: `backups/${b.id}/` }); for (const o of bk.objects) await env.DOCS.delete(o.key);
    await env.DB.prepare("DELETE FROM buildings WHERE id = ?").bind(b.id).run();
    await env.DB.prepare("DELETE FROM orgs WHERE id = ? AND NOT EXISTS (SELECT 1 FROM buildings WHERE org_id = ?)").bind(b.org_id, b.org_id).run();
  }
  await env.DB.prepare("DELETE FROM users WHERE demo_group = ?").bind(group).run();
  return buildings.length;
}

/** Cron: demo's zonder activiteit sinds 24 u opruimen. */
export async function cleanupDemos(env: AppEnv["Bindings"]) {
  const limit = new Date(Date.now() - DEMO_TTL_MS).toISOString();
  const groups = (await env.DB.prepare("SELECT DISTINCT demo_group FROM buildings WHERE demo_group IS NOT NULL AND COALESCE(demo_last_activity, '') < ?").bind(limit).all<{ demo_group: string }>()).results;
  for (const g of groups) await deleteDemoGroup(env, g.demo_group);
  // verweesde demo-gebruikers (gebouw al weg)
  await env.DB.prepare("DELETE FROM users WHERE demo_group IS NOT NULL AND demo_group NOT IN (SELECT demo_group FROM buildings WHERE demo_group IS NOT NULL)").run();
  return groups.length;
}

/** Testomgeving: een demo kunstmatig verouderen om de opruiming te testen. */
demo.post("/age", async (c) => {
  if (c.env.TEST_MODE !== "1") throw new HttpError(404, "Niet gevonden");
  const u = await loadUser(c); if (!u || !(u as any).demo_group) throw new HttpError(403, "Enkel in een demo");
  await c.env.DB.prepare("UPDATE buildings SET demo_last_activity = ? WHERE demo_group = ?").bind(new Date(Date.now() - DEMO_TTL_MS - 60_000).toISOString(), (u as any).demo_group).run();
  return c.json({ ok: true });
});
