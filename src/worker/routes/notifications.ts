import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { uid } from "../lib/util";
import { sendPushToUser } from "../lib/push";

const notifications = new Hono<AppEnv>();
notifications.use("*", requireAuth);

notifications.get("/", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare("SELECT n.*, b.name AS building_name FROM notifications n LEFT JOIN buildings b ON b.id = n.building_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100").bind(user.id).all();
  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(user.id).first<{ n: number }>();
  return c.json({ items: rows.results, unread: unread?.n ?? 0 });
});

notifications.post("/read", async (c) => {
  const user = c.get("user");
  const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(await c.req.json().catch(() => ({})));
  if (ids?.length) await c.env.DB.prepare(`UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(user.id, ...ids).run();
  else await c.env.DB.prepare("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL").bind(user.id).run();
  return c.json({ ok: true });
});

// ---- Web Push ----
notifications.post("/push/subscribe", async (c) => {
  const user = c.get("user");
  const sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(await c.req.json());
  await c.env.DB.prepare("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth")
    .bind(uid(), user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, c.req.header("user-agent") ?? null).run();
  return c.json({ ok: true });
});

notifications.post("/push/unsubscribe", async (c) => {
  const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, c.get("user").id).run();
  return c.json({ ok: true });
});

notifications.post("/push/test", async (c) => {
  await sendPushToUser(c.env, c.get("user").id, { title: "Trustee", body: "Push-meldingen werken! 🎉", url: c.env.APP_URL });
  return c.json({ ok: true });
});

export default notifications;
