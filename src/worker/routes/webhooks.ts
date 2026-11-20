import { Hono } from "hono";
import type { AppEnv } from "../env";
import { applyEmailEvent, verifyWebhook, type EmailEvent } from "../lib/delivery";

const webhooks = new Hono<AppEnv>();

/** Bezorgstatus van Resend. Zonder geheim bestaat de route niet; zonder geldige handtekening wordt niets verwerkt. */
webhooks.post("/resend", async (c) => {
  const secret = c.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "Niet gevonden" }, 404);
  const body = await c.req.text();
  const ok = await verifyWebhook(secret, { id: c.req.header("svix-id") ?? null, timestamp: c.req.header("svix-timestamp") ?? null, signature: c.req.header("svix-signature") ?? null }, body);
  if (!ok) return c.json({ error: "Ongeldige handtekening" }, 401);
  let ev: EmailEvent;
  try { ev = JSON.parse(body); } catch { return c.json({ error: "Ongeldige invoer" }, 400); }
  return c.json({ ok: true, ...(await applyEmailEvent(c.env, ev)) });
});

export default webhooks;
