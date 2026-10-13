import type { Env } from "../env";
import { layout, sendEmail } from "./email";
import { sendPushToUser } from "./push";
import { uid } from "./util";

export interface NotifyInput {
  buildingId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;        // relatief pad in de app, bv. /b/<id>/posts/<id>
  excludeUserId?: string;
  roles?: string[];     // enkel deze rollen (default: iedereen in het gebouw)
  userIds?: string[];   // of expliciet deze gebruikers
  email?: boolean;      // ook e-mail sturen (default true)
}

/** Maakt in-app notificaties, stuurt push en (optioneel) e-mail naar alle betrokken leden. */
export async function notifyBuilding(env: Env, input: NotifyInput) {
  let recipients: { user_id: string; email: string; name: string; notify_email: number; notify_push: number }[];
  if (input.userIds) {
    if (!input.userIds.length) return;
    const placeholders = input.userIds.map(() => "?").join(",");
    recipients = (await env.DB.prepare(
      `SELECT u.id AS user_id, u.email, u.name, COALESCE(bm.notify_email,1) AS notify_email, COALESCE(bm.notify_push,1) AS notify_push
       FROM users u LEFT JOIN building_members bm ON bm.user_id = u.id AND bm.building_id = ?
       WHERE u.id IN (${placeholders})`
    ).bind(input.buildingId, ...input.userIds).all()).results as any;
  } else {
    const roleFilter = input.roles?.length ? `AND bm.role IN (${input.roles.map(() => "?").join(",")})` : "";
    recipients = (await env.DB.prepare(
      `SELECT bm.user_id, u.email, u.name, bm.notify_email, bm.notify_push
       FROM building_members bm JOIN users u ON u.id = bm.user_id
       WHERE bm.building_id = ? ${roleFilter}`
    ).bind(input.buildingId, ...(input.roles ?? [])).all()).results as any;
  }
  recipients = recipients.filter((r) => r.user_id !== input.excludeUserId);
  if (!recipients.length) return;

  const stmt = env.DB.prepare(
    "INSERT INTO notifications (id, user_id, building_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  await env.DB.batch(recipients.map((r) => stmt.bind(uid(), r.user_id, input.buildingId, input.type, input.title, input.body ?? null, input.link ?? null)));

  const url = input.link ? `${env.APP_URL}${input.link}` : env.APP_URL;
  await Promise.all(recipients.map(async (r) => {
    if (r.notify_push) await sendPushToUser(env, r.user_id, { title: input.title, body: input.body, url, tag: input.type });
    if (r.notify_email && input.email !== false) {
      await sendEmail(env, r.email, input.title, layout(env, input.title, `<p>${escapeHtml(input.body ?? "")}</p>`, { label: "Openen in Trustee", url }), `${input.body ?? ""}\n\n${url}`);
    }
  }));
}

export async function audit(env: Env, buildingId: string | null, userId: string | null, action: string, targetType?: string, targetId?: string, meta?: unknown) {
  await env.DB.prepare("INSERT INTO audit_log (id, building_id, user_id, action, target_type, target_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(uid(), buildingId, userId, action, targetType ?? null, targetId ?? null, meta ? JSON.stringify(meta) : null).run();
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
