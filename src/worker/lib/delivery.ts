import type { Env } from "../env";
import { audit, notifyBuilding } from "./notify";
import { now } from "./util";

/**
 * Bezorgstatus van e-mail via de webhook van Resend (ondertekend volgens Svix / Standard Webhooks).
 * Een bounce of klacht markeert het adres van de gebruiker als onbezorgbaar: de syndicus van elk gebouw waar hij lid is krijgt een melding,
 * en de oproeping telt voor dat lid niet meer als elektronisch bezorgd (aangetekend versturen). Een latere geslaagde bezorging wist de markering.
 */

const b64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** Controleert de handtekening: HMAC-SHA256 over "<id>.<timestamp>.<body>" met het geheim na "whsec_" (base64); de header bevat één of meer "v1,<base64>". */
export async function verifyWebhook(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, atMs = Date.now()): Promise<boolean> {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(atMs / 1000 - ts) > 300) return false; // oude of toekomstige berichten weigeren (replay)
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey("raw", b64(secret.replace(/^whsec_/, "")) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]); } catch { return false; }
  const data = new TextEncoder().encode(`${h.id}.${h.timestamp}.${body}`);
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    try { if (await crypto.subtle.verify("HMAC", key, b64(sig) as BufferSource, data as BufferSource)) return true; } catch { /* ongeldige base64 */ }
  }
  return false;
}

const STATUS: Record<string, string> = { "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed", "email.suppressed": "bounced" };

export interface EmailEvent { type: string; created_at?: string; data?: { email_id?: string; to?: string[] | string; bounce?: { message?: string; type?: string; subType?: string } } }

/** Verwerkt één gebeurtenis; geeft terug wat er gebeurde (voor het antwoord en de tests). */
export async function applyEmailEvent(env: Env, ev: EmailEvent): Promise<{ status: string | null; flagged: string[]; cleared: string[] }> {
  const status = STATUS[ev.type] ?? null;
  const out = { status, flagged: [] as string[], cleared: [] as string[] };
  if (!status || !ev.data) return out;
  const transient = ev.type === "email.bounced" && ev.data.bounce?.type === "Transient"; // volle mailbox, tijdelijke storing: wel loggen, niet markeren
  const reason = ev.type === "email.complained" ? "De ontvanger markeerde het bericht als ongewenst" : ev.type === "email.suppressed" ? "Adres staat op de lijst van eerder onbezorgbare adressen" : [ev.data.bounce?.type, ev.data.bounce?.subType, ev.data.bounce?.message].filter(Boolean).join(": ") || null;
  const userIds = new Set<string>();
  if (ev.data.email_id) {
    const rows = (await env.DB.prepare("SELECT id, user_id, to_email, status FROM email_log WHERE provider_id = ?").bind(ev.data.email_id).all<{ id: string; user_id: string | null; to_email: string; status: string }>()).results;
    for (const r of rows) {
      // "sent" komt soms na "delivered" binnen: een eindstatus niet terugzetten
      if (!(status === "sent" && r.status !== "logged")) await env.DB.prepare("UPDATE email_log SET status = ?, detail = ?, updated_at = ? WHERE id = ?").bind(status, reason, now(), r.id).run();
      if (r.user_id) userIds.add(r.user_id);
    }
  }
  // berichten zonder logboekregel (bv. wachtwoord vergeten): de gebruiker opzoeken op adres
  if (!userIds.size) for (const to of [ev.data.to ?? []].flat()) { const u = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(String(to).toLowerCase().trim()).first<{ id: string }>(); if (u) userIds.add(u.id); }

  for (const userId of userIds) {
    if (status === "delivered") {
      const r = await env.DB.prepare("UPDATE users SET email_bounced_at = NULL, email_bounce_reason = NULL WHERE id = ? AND email_bounced_at IS NOT NULL").bind(userId).run();
      if (r.meta.changes) { out.cleared.push(userId); for (const m of await memberships(env, userId)) await audit(env, m.building_id, null, "email.delivered_again", "user", userId); }
    } else if ((status === "bounced" || status === "complained") && !transient) {
      const r = await env.DB.prepare("UPDATE users SET email_bounced_at = ?, email_bounce_reason = ? WHERE id = ? AND email_bounced_at IS NULL").bind(now(), reason, userId).run();
      if (!r.meta.changes) continue; // al gemarkeerd: geen tweede melding
      out.flagged.push(userId);
      const u = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(userId).first<{ name: string; email: string }>();
      for (const m of await memberships(env, userId)) {
        await audit(env, m.building_id, null, "email.bounced", "user", userId, { status, reason });
        await notifyBuilding(env, { buildingId: m.building_id, type: "delivery", title: `E-mail onbezorgbaar: ${u?.name ?? "lid"}`, body: `Een e-mail aan ${u?.name} (${u?.email}) kwam niet aan${reason ? ` (${reason})` : ""}. Oproepingen en notulen gelden voor dit lid niet als elektronisch bezorgd: verstuur ze aangetekend en vraag een werkend e-mailadres.`, link: `/b/${m.building_id}/members`, roles: ["syndicus"], excludeUserId: userId });
      }
    }
  }
  return out;
}

const memberships = async (env: Env, userId: string) => (await env.DB.prepare("SELECT building_id FROM building_members WHERE user_id = ?").bind(userId).all<{ building_id: string }>()).results;
