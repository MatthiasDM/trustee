import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { HttpError, plusMs, randomToken, uid } from "./util";
import { hashPassword } from "./password";
import { layout, sendEmail } from "./email";

/**
 * Volmachtdrager van buiten het gebouw (art. 3.87 §7 BW: de lasthebber is "al dan niet lid van de algemene vergadering").
 *
 * Een derde krijgt een tijdelijk account, zodat voor hem alles geldt wat voor een lid geldt: de telling van volmachten, het stemplafond,
 * het belangenconflict, stemmen vanop afstand en de notulen tekenen. Hij wordt geen lid van het gebouw: zijn toegang volgt uit de volmacht
 * zelf (meeting_rsvps.proxy_user_id) en is beperkt tot die vergadering. Ze vervalt zodra de notulen definitief zijn, de vergadering
 * geannuleerd is, de volmacht ingetrokken is, of 60 dagen na de vergadering.
 */
export const HOLDER_ROLE = "volmachtdrager";
const PLACEHOLDER_DOMAIN = "volmacht.invalid"; // account zonder e-mailadres: bestaat enkel als naam; .invalid-adressen krijgen nooit mail
export const isPlaceholderEmail = (email: string) => email.endsWith(`@${PLACEHOLDER_DOMAIN}`);
const ACTIVE = "m.cancelled_at IS NULL AND m.minutes_status != 'final' AND m.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')";

/** De vergaderingen van dit gebouw waarvoor de gebruiker nu een volmacht draagt. */
export async function holderMeetings(db: D1Database, buildingId: string, userId: string): Promise<string[]> {
  return (await db.prepare(`SELECT DISTINCT m.id FROM meeting_rsvps r JOIN meetings m ON m.id = r.meeting_id WHERE m.building_id = ? AND r.status = 'proxy' AND r.proxy_user_id = ? AND ${ACTIVE}`).bind(buildingId, userId).all<{ id: string }>()).results.map((r) => r.id);
}
/** Voor /api/auth/me: de gebouwen waar de gebruiker enkel als volmachtdrager toegang heeft. */
export const HOLDER_BUILDINGS_SQL = `EXISTS (SELECT 1 FROM meeting_rsvps r JOIN meetings m ON m.id = r.meeting_id WHERE m.building_id = b.id AND r.status = 'proxy' AND r.proxy_user_id = ?1 AND ${ACTIVE})`;

/** Wat een volmachtdrager zonder lidmaatschap mag: enkel zijn vergadering(en). Al het andere is geweigerd. */
export function holderMayAccess(method: string, path: string, query: (k: string) => string | undefined, meetings: string[]): boolean {
  const rest = path.replace(/^\/api\/buildings\/[^/]+/, "");
  if (method === "GET" && rest === "/meetings") return true; // de route toont enkel zijn vergaderingen
  if (method === "GET" && rest === "/agenda") return meetings.includes(query("meeting") ?? "");
  const m = rest.match(/^\/meetings\/([^/]+)(\/.*)$/);
  if (!m || !meetings.includes(m[1])) return false;
  const sub = m[2];
  if (method === "GET") return ["/attendance", "/remote", "/ics", "/minutes/signatures"].includes(sub);
  if (method === "PUT") return sub === "/rsvp" || /^\/agenda\/[^/]+\/ballot$/.test(sub);
  if (method === "POST") return sub === "/minutes/sign";
  if (method === "DELETE") return /^\/minutes\/signatures\/[^/]+$/.test(sub);
  return false;
}

/** Namen vergelijken zonder hoofdletters, accenten en dubbele spaties. */
export const normName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Zoekt of maakt het account van een derde die een volmacht krijgt. Geeft het user_id terug; de volmachtregels zelf controleert validateProxy.
 * - bestaat er een account met dit e-mailadres, dan wordt dat gebruikt (een lid van het gebouw wordt zo gewoon als lid gekozen);
 * - zonder e-mailadres: een eerder aangemaakte volmachtdrager met dezelfde naam in dit gebouw wordt hergebruikt, zodat zijn volmachten samen tellen;
 * - anders komt er een nieuw account, met een uitnodiging om een wachtwoord te kiezen als er een e-mailadres is.
 */
export async function ensureExternalHolder(c: Context<AppEnv>, input: { name?: string | null; email?: string | null }, meeting: { id: string; title: string; starts_at: string }): Promise<{ user_id: string; created: boolean; invited: boolean; invite_token?: string }> {
  const env = c.env; const b = c.get("building"); const grantor = c.get("user");
  const name = (input.name ?? "").trim().replace(/\s+/g, " "); const email = input.email?.trim().toLowerCase() || null;
  if (name.length < 3) throw new HttpError(400, "Vul de volledige naam van de volmachtdrager in: de volmacht vermeldt de naam van de lasthebber (art. 3.87 §7 BW)");
  const key = normName(name);
  const members = (await env.DB.prepare("SELECT bm.user_id, bm.role, u.name, u.email FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ?").bind(b.id).all<{ user_id: string; role: string; name: string; email: string }>()).results;
  const sameName = members.filter((p) => normName(p.name) === key);
  if (sameName.some((p) => p.role === "syndicus")) throw new HttpError(400, "De syndicus mag geen volmachten dragen (art. 3.87 §7 BW)");
  if (key === normName(grantor.name) || email === grantor.email.toLowerCase()) throw new HttpError(400, "Je kan jezelf geen volmacht geven");
  if (sameName.length) throw new HttpError(400, `${sameName[0].name} is lid van dit gebouw: kies hem of haar in de lijst in plaats van de naam in te vullen`);

  if (email) {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) return { user_id: existing.id, created: false, invited: false }; // lid of bestaand account: validateProxy beslist verder
  }
  // eerder aangemaakte volmachtdrager zonder e-mailadres met dezelfde naam, in dit gebouw
  const earlier = (await env.DB.prepare(`SELECT DISTINCT u.id, u.name FROM users u JOIN meeting_rsvps r ON r.proxy_user_id = u.id JOIN meetings m ON m.id = r.meeting_id WHERE m.building_id = ? AND u.email LIKE ?`).bind(b.id, `%@${PLACEHOLDER_DOMAIN}`).all<{ id: string; name: string }>()).results.find((u) => normName(u.name) === key);
  let userId = earlier?.id ?? null; let created = false;
  if (!userId) {
    // rem op het aanmaken van accounts: per volmachtgever hoogstens tien nieuwe volmachtdragers per dag
    const rl = `holder:new:${grantor.id}:${new Date().toISOString().slice(0, 10)}`; const n = Number((await env.KV.get(rl)) ?? 0);
    if (n >= 10) throw new HttpError(429, "Je hebt vandaag al tien nieuwe volmachtdragers opgegeven. Probeer het morgen opnieuw of vraag het de syndicus.");
    await env.KV.put(rl, String(n + 1), { expirationTtl: 90000 });
    userId = uid(); created = true;
    await env.DB.prepare("INSERT INTO users (id, email, name, password_hash, locale) VALUES (?,?,?,?,?)").bind(userId, email ?? `volmacht-${userId}@${PLACEHOLDER_DOMAIN}`, name, await hashPassword(randomToken()), grantor.locale ?? "nl").run();
  } else if (email) await env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, userId).run();
  if (!email) return { user_id: userId, created, invited: false };

  // uitnodiging: een link om een wachtwoord te kiezen, 14 dagen geldig
  const token = randomToken();
  await env.DB.prepare("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, plusMs(14 * 86400_000)).run();
  const url = `${env.APP_URL}/reset-password?token=${token}`;
  const when = new Date(meeting.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
  await sendEmail(env, email, `Volmacht voor de algemene vergadering van ${b.name}`, layout(env, "Je draagt een volmacht", `<p>Hallo ${name},</p><p>${grantor.name} gaf je een volmacht voor de vergadering "${meeting.title}" van ${when} (${b.name}).</p><p>Kies een wachtwoord om de agenda te bekijken, vanop afstand te stemmen als de vergadering dat toelaat, en de notulen te tekenen. Je toegang is beperkt tot deze vergadering en vervalt zodra de notulen definitief zijn. De link is 14 dagen geldig.</p><p>Ken je ${grantor.name} niet of wil je deze volmacht niet dragen, dan hoef je niets te doen.</p>`, { label: "Wachtwoord kiezen", url }), url, { buildingId: b.id, userId, kind: "proxy_invite" });
  return { user_id: userId, created, invited: true, ...(env.TEST_MODE === "1" ? { invite_token: token } : {}) };
}

/** Voor beheerders: de volmachtdragers van buiten het gebouw die nu een volmacht dragen (o.a. om een belangenconflict vast te leggen). */
export async function activeExternalHolders(env: Env, buildingId: string) {
  return (await env.DB.prepare(`SELECT DISTINCT u.id AS user_id, u.name, u.email FROM meeting_rsvps r JOIN meetings m ON m.id = r.meeting_id JOIN users u ON u.id = r.proxy_user_id
    WHERE m.building_id = ?1 AND r.status = 'proxy' AND ${ACTIVE} AND u.id NOT IN (SELECT user_id FROM building_members WHERE building_id = ?1) ORDER BY u.name`).bind(buildingId).all<{ user_id: string; name: string; email: string }>()).results
    .map((u) => ({ user_id: u.user_id, name: u.name, has_account: !isPlaceholderEmail(u.email) }));
}
