import { Hono, type Context } from "hono";
import { z } from "zod";
import { LEGAL_VERSIONS, type LegalDoc } from "../../shared/legal";
import type { AppEnv } from "../env";
import { hashPassword, verifyPassword } from "../lib/password";
import { createSession, destroySession, loadUser, requireAuth } from "../lib/auth";
import { HttpError, plusMs, randomToken, uid } from "../lib/util";
import { layout, sendEmail } from "../lib/email";
import { audit } from "../lib/notify";
import { rateLimit } from "../lib/ratelimit";
import { generateRecoveryCodes, generateSecret, otpauthUrl, sha256Hex, verifyTotp } from "../lib/totp";
import { DEMO_TTL_MS, demoUsers } from "./demo";
import { ACTING_SYNDICUS_SQL } from "../lib/governance";
import { syncChildUnits } from "../lib/subassoc";

const auth = new Hono<AppEnv>();

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  orgName: z.string().min(2).max(120).optional(), // nieuw syndicuskantoor aanmaken
  inviteToken: z.string().optional(),
  accept_terms: z.literal(true, { message: "Je moet de voorwaarden en de privacyverklaring aanvaarden" }),
});

auth.post("/register", rateLimit({ name: "register", limit: 10, windowSec: 3600 }), async (c) => {
  const body = registerSchema.parse(await c.req.json());
  const email = body.email.toLowerCase().trim();
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw new HttpError(409, "Er bestaat al een account met dit e-mailadres");

  const userId = uid();
  await c.env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)")
    .bind(userId, email, body.name.trim(), await hashPassword(body.password)).run();

  if (body.inviteToken) {
    await acceptInvite(c.env.DB, body.inviteToken, userId, email);
  } else if (body.orgName) {
    const orgId = uid();
    const slug = body.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + randomToken(3).toLowerCase();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO orgs (id, name, slug) VALUES (?, ?, ?)").bind(orgId, body.orgName.trim(), slug),
      c.env.DB.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')").bind(orgId, userId),
    ]);
  }
  await recordConsents(c, userId);
  await createSession(c, userId);
  await audit(c.env, null, userId, "user.register");
  return c.json({ ok: true });
});

auth.post("/login", rateLimit({ name: "login", limit: 10, windowSec: 900, keyFrom: (_c, b) => b?.email ?? null, failuresOnly: true }), async (c) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(await c.req.json());
  const user = await c.env.DB.prepare("SELECT id, password_hash, totp_enabled_at FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first<{ id: string; password_hash: string; totp_enabled_at: string | null }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new HttpError(401, "Ongeldige e-mail of wachtwoord");
  if (user.totp_enabled_at) {
    // Tweede stap: kortlevende uitdaging in KV; pas na een geldige code (of herstelcode) komt er een sessie.
    const challenge = randomToken(24);
    await c.env.KV.put(`totp:login:${challenge}`, user.id, { expirationTtl: 300 });
    return c.json({ totp_required: true, challenge });
  }
  await createSession(c, user.id);
  return c.json({ ok: true });
});

auth.post("/login/totp", rateLimit({ name: "totp", limit: 8, windowSec: 900, keyFrom: (_c, b) => b?.challenge ?? null }), async (c) => {
  const { challenge, code } = z.object({ challenge: z.string(), code: z.string().min(6).max(12) }).parse(await c.req.json());
  const userId = await c.env.KV.get(`totp:login:${challenge}`);
  if (!userId) throw new HttpError(401, "Uitdaging verlopen; meld opnieuw aan");
  const u = await c.env.DB.prepare("SELECT totp_secret, totp_recovery FROM users WHERE id = ?").bind(userId).first<{ totp_secret: string; totp_recovery: string | null }>();
  if (!u?.totp_secret) throw new HttpError(401, "Tweestapsverificatie niet actief");
  let ok = await verifyTotp(u.totp_secret, code);
  if (!ok && u.totp_recovery) {
    const hashes: string[] = JSON.parse(u.totp_recovery); const h = await sha256Hex(code.toLowerCase().replace(/\s/g, ""));
    if (hashes.includes(h)) { ok = true; await c.env.DB.prepare("UPDATE users SET totp_recovery = ? WHERE id = ?").bind(JSON.stringify(hashes.filter((x) => x !== h)), userId).run(); await audit(c.env, null, userId, "user.totp_recovery_used"); }
  }
  if (!ok) throw new HttpError(401, "Ongeldige code");
  await c.env.KV.delete(`totp:login:${challenge}`);
  await createSession(c, userId);
  return c.json({ ok: true });
});

/** Stap 1 van activatie: geheim genereren (10 min geldig in KV) en als otpauth-URL teruggeven voor de authenticator-app. */
auth.post("/totp/setup", requireAuth, async (c) => {
  const user = c.get("user");
  const secret = generateSecret();
  await c.env.KV.put(`totp:setup:${user.id}`, secret, { expirationTtl: 600 });
  return c.json({ secret, otpauth: otpauthUrl(c.env.APP_NAME || "Trustee", user.email, secret) });
});
/** Stap 2: eerste geldige code bevestigt; herstelcodes worden één keer getoond. */
auth.post("/totp/enable", requireAuth, async (c) => {
  const user = c.get("user");
  const { code } = z.object({ code: z.string() }).parse(await c.req.json());
  const secret = await c.env.KV.get(`totp:setup:${user.id}`);
  if (!secret) throw new HttpError(400, "Start de activatie opnieuw (geheim verlopen)");
  if (!(await verifyTotp(secret, code))) throw new HttpError(400, "Ongeldige code; controleer de tijd op je toestel");
  const codes = generateRecoveryCodes();
  await c.env.DB.prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = ?, totp_recovery = ? WHERE id = ?").bind(secret, new Date().toISOString(), JSON.stringify(await Promise.all(codes.map(sha256Hex))), user.id).run();
  await c.env.KV.delete(`totp:setup:${user.id}`);
  await audit(c.env, null, user.id, "user.totp_enabled");
  return c.json({ ok: true, recovery_codes: codes });
});
auth.post("/totp/disable", requireAuth, async (c) => {
  const user = c.get("user");
  const { password, code } = z.object({ password: z.string(), code: z.string() }).parse(await c.req.json());
  const u = await c.env.DB.prepare("SELECT password_hash, totp_secret FROM users WHERE id = ?").bind(user.id).first<any>();
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new HttpError(401, "Wachtwoord onjuist");
  if (!u.totp_secret || !(await verifyTotp(u.totp_secret, code))) throw new HttpError(400, "Ongeldige code");
  await c.env.DB.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_recovery = NULL WHERE id = ?").bind(user.id).run();
  await audit(c.env, null, user.id, "user.totp_disabled");
  return c.json({ ok: true });
});
/** Alle sessies beëindigen (verloren toestel, verdachte activiteit); de huidige sessie blijft. */
auth.post("/logout-all", requireAuth, async (c) => {
  const user = c.get("user");
  const r = await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(user.id, c.get("sessionId")).run();
  await audit(c.env, null, user.id, "user.logout_all", undefined, undefined, { sessions: r.meta.changes });
  return c.json({ ok: true, ended: r.meta.changes });
});

auth.post("/logout", async (c) => { await destroySession(c); return c.json({ ok: true }); });

/** Logt de aanvaarding van de huidige versie van voorwaarden en privacyverklaring (bewijs: versie, datum, IP, browser). */
async function recordConsents(c: Context<AppEnv>, userId: string) {
  const ip = c.req.header("cf-connecting-ip") ?? null; const ua = (c.req.header("user-agent") ?? "").slice(0, 300) || null;
  await c.env.DB.batch((Object.keys(LEGAL_VERSIONS) as LegalDoc[]).map((d) => c.env.DB.prepare("INSERT INTO consents (id, user_id, document, version, ip, user_agent) VALUES (?,?,?,?,?,?)").bind(uid(), userId, d, LEGAL_VERSIONS[d], ip, ua)));
}
/** Welke documenten de gebruiker nog moet aanvaarden (nieuwe versie of nooit aanvaard). */
async function pendingConsents(env: AppEnv["Bindings"], userId: string): Promise<LegalDoc[]> {
  const rows = (await env.DB.prepare("SELECT document, version FROM consents WHERE user_id = ?").bind(userId).all<{ document: string; version: string }>()).results;
  return (Object.keys(LEGAL_VERSIONS) as LegalDoc[]).filter((d) => !rows.some((r) => r.document === d && r.version === LEGAL_VERSIONS[d]));
}
auth.post("/consent", requireAuth, async (c) => { await recordConsents(c, c.get("user").id); await audit(c.env, null, c.get("user").id, "user.consent", undefined, undefined, LEGAL_VERSIONS); return c.json({ ok: true }); });

auth.get("/me", async (c) => {
  const user = await loadUser(c);
  if (!user) return c.json({ user: null, demo_enabled: c.env.DEMO_MODE === "1", demo_only: c.env.DEMO_ONLY === "1" });
  const demoInfo = user.demo_group ? { group: user.demo_group, users: await demoUsers(c.env, user.demo_group), ttl_hours: DEMO_TTL_MS / 3600_000 } : null;
  const orgs = await c.env.DB.prepare("SELECT o.id, o.name, o.plan, om.role FROM org_members om JOIN orgs o ON o.id = om.org_id WHERE om.user_id = ?").bind(user.id).all();
  const buildings = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.address, b.city, b.org_id, o.name AS org_name, b.dissolution_status, b.parent_building_id, b.sub_scope, (SELECT name FROM buildings pb WHERE pb.id = b.parent_building_id) AS parent_name,
            CASE WHEN ${ACTING_SYNDICUS_SQL} THEN 'syndicus' ELSE bm.role END AS role,
            (SELECT COUNT(*) FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE un.building_id = b.id AND uo.user_id = ?1) AS units,
            (CASE WHEN bm.role != 'syndicus' AND ${ACTING_SYNDICUS_SQL} THEN 1 ELSE 0 END) AS acting
     FROM building_members bm JOIN buildings b ON b.id = bm.building_id JOIN orgs o ON o.id = b.org_id
     WHERE bm.user_id = ?1
     UNION
     SELECT b.id, b.name, b.address, b.city, b.org_id, o.name AS org_name, b.dissolution_status, b.parent_building_id, b.sub_scope, (SELECT name FROM buildings pb WHERE pb.id = b.parent_building_id) AS parent_name, 'syndicus' AS role, 0 AS units, 0 AS acting
     FROM org_members om JOIN buildings b ON b.org_id = om.org_id JOIN orgs o ON o.id = b.org_id
     WHERE om.user_id = ?1 AND b.id NOT IN (SELECT building_id FROM building_members WHERE user_id = ?1)
     UNION
     SELECT b.id, b.name, b.address, b.city, b.org_id, o.name AS org_name, b.dissolution_status, b.parent_building_id, b.sub_scope, (SELECT name FROM buildings pb WHERE pb.id = b.parent_building_id) AS parent_name, 'syndicus' AS role, 0 AS units, 1 AS acting
     FROM buildings b JOIN orgs o ON o.id = b.org_id
     WHERE b.liquidator_user_id = ?1 AND b.dissolution_status = 'in_liquidation' AND b.id NOT IN (SELECT building_id FROM building_members WHERE user_id = ?1) AND b.org_id NOT IN (SELECT org_id FROM org_members WHERE user_id = ?1)
     UNION
     SELECT b.id, b.name, b.address, b.city, b.org_id, o.name AS org_name, b.dissolution_status, b.parent_building_id, b.sub_scope, (SELECT name FROM buildings pb WHERE pb.id = b.parent_building_id) AS parent_name, 'syndicus' AS role, 0 AS units, 1 AS acting
     FROM mandates md JOIN buildings b ON b.id = md.building_id JOIN orgs o ON o.id = b.org_id
     WHERE md.user_id = ?1 AND md.organ IN ('syndicus','voorlopig_syndicus','voorlopig_bewindvoerder') AND md.start_date <= date('now') AND md.end_date >= date('now')
       AND b.id NOT IN (SELECT building_id FROM building_members WHERE user_id = ?1) AND b.org_id NOT IN (SELECT org_id FROM org_members WHERE user_id = ?1)
     ORDER BY 2`
  ).bind(user.id).all();
  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(user.id).first<{ n: number }>();
  const sec = await c.env.DB.prepare("SELECT (SELECT totp_enabled_at FROM users WHERE id = ?1) AS totp_enabled_at, (SELECT COUNT(*) FROM sessions WHERE user_id = ?1) AS sessions").bind(user.id).first<any>();
  return c.json({ user, demo: demoInfo, demo_enabled: c.env.DEMO_MODE === "1", demo_only: c.env.DEMO_ONLY === "1", security: { totp_enabled: !!sec?.totp_enabled_at, sessions: sec?.sessions ?? 0 }, orgs: orgs.results, buildings: buildings.results, unread: unread?.n ?? 0, vapidPublicKey: c.env.VAPID_PUBLIC_KEY || null, consents_required: await pendingConsents(c.env, user.id), legal_versions: LEGAL_VERSIONS });
});

auth.patch("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const body = z.object({ name: z.string().min(2).max(120).optional(), phone: z.string().max(40).nullable().optional(), locale: z.enum(["nl", "fr", "en"]).optional() }).parse(await c.req.json());
  await c.env.DB.prepare("UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), locale = COALESCE(?, locale) WHERE id = ?")
    .bind(body.name ?? null, body.phone ?? null, body.locale ?? null, user.id).run();
  return c.json({ ok: true });
});

auth.post("/change-password", requireAuth, async (c) => {
  const user = c.get("user");
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8).max(200) }).parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new HttpError(400, "Huidig wachtwoord klopt niet");
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(next), user.id).run();
  return c.json({ ok: true });
});

auth.post("/forgot-password", rateLimit({ name: "forgot", limit: 5, windowSec: 3600, keyFrom: (_c, b) => b?.email ?? null }), async (c) => {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  const user = await c.env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first<{ id: string; name: string }>();
  if (user) {
    const token = randomToken();
    await c.env.DB.prepare("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, plusMs(3600_000)).run();
    const url = `${c.env.APP_URL}/reset-password?token=${token}`;
    await sendEmail(c.env, email, "Wachtwoord opnieuw instellen", layout(c.env, "Wachtwoord opnieuw instellen", `<p>Hallo ${user.name},</p><p>Klik op de knop om een nieuw wachtwoord in te stellen. De link is 1 uur geldig.</p>`, { label: "Nieuw wachtwoord", url }), url);
  }
  return c.json({ ok: true });
});

auth.post("/reset-password", rateLimit({ name: "reset", limit: 10, windowSec: 3600 }), async (c) => {
  const { token, password } = z.object({ token: z.string(), password: z.string().min(8).max(200) }).parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM password_resets WHERE token = ?").bind(token).first<{ user_id: string; expires_at: string }>();
  if (!row || row.expires_at < new Date().toISOString()) throw new HttpError(400, "Ongeldige of verlopen link");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), row.user_id),
    c.env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(row.user_id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
  ]);
  return c.json({ ok: true });
});

/** AVG: alle gegevens van de aangemelde gebruiker als JSON. */
auth.get("/me/export", requireAuth, async (c) => {
  const user = c.get("user");
  const q = async (sql: string) => (await c.env.DB.prepare(sql).bind(user.id).all()).results;
  const data = {
    exported_at: new Date().toISOString(), user,
    memberships: await q("SELECT bm.*, b.name AS building_name FROM building_members bm JOIN buildings b ON b.id = bm.building_id WHERE bm.user_id = ?"),
    units: await q("SELECT uo.*, un.label, un.building_id FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE uo.user_id = ?"),
    posts: await q("SELECT * FROM posts WHERE author_id = ?"), comments: await q("SELECT * FROM comments WHERE author_id = ?"),
    votes: await q("SELECT * FROM poll_votes WHERE user_id = ?"), rsvps: await q("SELECT * FROM meeting_rsvps WHERE user_id = ?"),
    agenda_items: await q("SELECT * FROM agenda_items WHERE submitted_by = ?"), mandates: await q("SELECT * FROM mandates WHERE user_id = ?"),
    notifications: await q("SELECT * FROM notifications WHERE user_id = ?"), push_subscriptions: await q("SELECT id, endpoint, user_agent, created_at FROM push_subscriptions WHERE user_id = ?"),
    audit: await q("SELECT * FROM audit_log WHERE user_id = ?"),
  };
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="trustee-export-${user.id}.json"` } });
});

/**
 * AVG: account verwijderen. Boekhoudkundige en besluitvormingsgegevens (stemmen, boekingen, notulen) moeten bewaard blijven
 * (wettelijke bewaartermijn), dus de gebruiker wordt geanonimiseerd: naam en e-mail vervangen, sessies, push en lidmaatschappen verwijderd.
 */
auth.delete("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const { password } = z.object({ password: z.string() }).parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(400, "Wachtwoord klopt niet");
  const activeSyndicus = await c.env.DB.prepare("SELECT b.name FROM building_members bm JOIN buildings b ON b.id = bm.building_id WHERE bm.user_id = ? AND bm.role = 'syndicus' AND (SELECT COUNT(*) FROM building_members x WHERE x.building_id = bm.building_id AND x.role = 'syndicus') = 1").bind(user.id).first<{ name: string }>();
  if (activeSyndicus) throw new HttpError(400, `Je bent de enige syndicus van ${activeSyndicus.name}. Draag het beheer eerst over.`);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET name = 'Verwijderde gebruiker', email = ?, phone = NULL, password_hash = 'deleted', is_superadmin = 0 WHERE id = ?").bind(`deleted-${user.id}@invalid.local`, user.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM notifications WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM building_members WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM org_members WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM unit_owners WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
  ]);
  await audit(c.env, null, user.id, "user.delete");
  await destroySession(c);
  return c.json({ ok: true });
});

/** Info over een uitnodiging (publiek, enkel via token). */
auth.get("/invite/:token", async (c) => {
  const inv = await c.env.DB.prepare(
    `SELECT i.email, i.name, i.role, i.expires_at, i.accepted_at, b.name AS building_name, b.address, u.label AS unit_label
     FROM invites i JOIN buildings b ON b.id = i.building_id LEFT JOIN units u ON u.id = i.unit_id WHERE i.token = ?`
  ).bind(c.req.param("token")).first<any>();
  if (!inv) throw new HttpError(404, "Uitnodiging niet gevonden");
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(inv.email).first();
  return c.json({ ...inv, has_account: !!existing, expired: inv.expires_at < new Date().toISOString() });
});

/** Uitnodiging accepteren met een bestaand (aangemeld) account. */
auth.post("/invite/:token/accept", requireAuth, async (c) => {
  const user = c.get("user");
  const buildingId = await acceptInvite(c.env.DB, c.req.param("token"), user.id, user.email);
  return c.json({ ok: true, buildingId });
});

export async function acceptInvite(db: D1Database, token: string, userId: string, email: string): Promise<string> {
  const inv = await db.prepare("SELECT * FROM invites WHERE token = ?").bind(token).first<any>();
  if (!inv) throw new HttpError(404, "Uitnodiging niet gevonden");
  if (inv.accepted_at) throw new HttpError(400, "Uitnodiging is al gebruikt");
  if (inv.expires_at < new Date().toISOString()) throw new HttpError(400, "Uitnodiging is verlopen");
  if (inv.email.toLowerCase() !== email.toLowerCase()) throw new HttpError(403, "Deze uitnodiging is voor een ander e-mailadres");
  const stmts = [
    db.prepare("INSERT OR REPLACE INTO building_members (building_id, user_id, role) VALUES (?, ?, ?)").bind(inv.building_id, userId, inv.role),
    db.prepare("UPDATE invites SET accepted_at = ? WHERE id = ?").bind(new Date().toISOString(), inv.id),
  ];
  if (inv.unit_id) stmts.push(db.prepare("INSERT OR IGNORE INTO unit_owners (unit_id, user_id) VALUES (?, ?)").bind(inv.unit_id, userId));
  await db.batch(stmts);
  if (inv.unit_id) await syncChildUnits(db, inv.unit_id);
  return inv.building_id;
}

export default auth;
