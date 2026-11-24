import type { Env } from "../env";
import { audit, notifyBuilding } from "./notify";
import { now } from "./util";

/**
 * Bezorgstatus van e-mail via de gebeurtenissen van Cloudflare Email Service (event subscription op een queue, zie wrangler.jsonc).
 * Een bounce, klacht of onderdrukt adres markeert het adres van de gebruiker als onbezorgbaar: de syndicus van elk gebouw waar hij lid is
 * krijgt een melding, en de oproeping telt voor dat lid niet meer als elektronisch bezorgd (aangetekend versturen).
 * Een latere geslaagde bezorging wist de markering. De queue is enkel door Cloudflare te vullen: er is geen publiek eindpunt.
 */

const PREFIX = "cf.email.sending.message.";
const STATUS: Record<string, string> = { delivered: "delivered", deferred: "delayed", bounced: "bounced", complained: "complained", rejected: "bounced", failed: "failed" };

export interface EmailEvent {
  type: string;
  payload?: {
    messageId?: string; recipient?: string;
    delivery?: { status?: string; smtpResponse?: string };
    bounce?: { type?: string; classification?: string; reason?: string };
  };
}

/** Verwerkt één gebeurtenis; geeft terug wat er gebeurde (voor de tests). */
export async function applyEmailEvent(env: Env, ev: EmailEvent): Promise<{ status: string | null; flagged: string[]; cleared: string[] }> {
  const kind = ev?.type?.startsWith(PREFIX) ? ev.type.slice(PREFIX.length) : "";
  const status = STATUS[kind] ?? null;
  const out = { status, flagged: [] as string[], cleared: [] as string[] };
  const p = ev?.payload;
  if (!status || !p) return out;
  const transient = kind === "bounced" && p.bounce?.type === "soft"; // volle mailbox, tijdelijke storing: wel loggen, niet markeren
  const reason = kind === "complained" ? "De ontvanger markeerde het bericht als ongewenst"
    : kind === "rejected" ? "Adres staat op de lijst van eerder onbezorgbare adressen"
    : kind === "delivered" ? null
    : (p.bounce?.reason ?? p.delivery?.smtpResponse ?? null);
  const userIds = new Set<string>();
  if (p.messageId) {
    const rows = (await env.DB.prepare("SELECT id, user_id, to_email, status FROM email_log WHERE provider_id = ?").bind(p.messageId).all<{ id: string; user_id: string | null; to_email: string; status: string }>()).results;
    for (const r of rows) {
      if (p.recipient && r.to_email.toLowerCase() !== p.recipient.toLowerCase()) continue;
      // "deferred" komt soms na "delivered" binnen: een eindstatus niet terugzetten
      if (!(status === "delayed" && ["delivered", "bounced", "complained"].includes(r.status))) await env.DB.prepare("UPDATE email_log SET status = ?, detail = ?, updated_at = ? WHERE id = ?").bind(status, reason?.slice(0, 500) ?? null, now(), r.id).run();
      if (r.user_id) userIds.add(r.user_id);
    }
  }
  // berichten zonder logboekregel (bv. wachtwoord vergeten): de gebruiker opzoeken op adres
  if (!userIds.size && p.recipient) { const u = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(p.recipient.toLowerCase().trim()).first<{ id: string }>(); if (u) userIds.add(u.id); }

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
