import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import type { Env } from "../env";

export interface PushMessage { title: string; body?: string; url?: string; tag?: string }

export async function sendPushToUser(env: Env, userId: string, msg: PushMessage) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;
  const subs = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .bind(userId).all<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  const vapid: VapidKeys = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  await Promise.all(subs.results.map(async (s) => {
    const sub: PushSubscription = { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(msg), options: { ttl: 60 * 60 * 24, urgency: "normal" } }, sub, vapid);
      const res = await fetch(s.endpoint, payload);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(s.id).run();
      } else if (!res.ok) {
        console.warn("push failed", res.status, await res.text());
      }
    } catch (e) {
      console.error("push error", e);
    }
  }));
}
