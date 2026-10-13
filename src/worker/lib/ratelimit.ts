import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "./util";

/**
 * Eenvoudige rate limiter op KV: vast venster per sleutel (IP of IP+e-mail).
 * KV is eventueel consistent; voor brute-force-bescherming volstaat dat.
 */
export function rateLimit(opts: { name: string; limit: number; windowSec: number; keyFrom?: (c: Context<AppEnv>, body: any) => string | null }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    let extra: string | null = null;
    if (opts.keyFrom) { try { const body = await c.req.raw.clone().json(); extra = opts.keyFrom(c, body); } catch { extra = null; } }
    const bucket = Math.floor(Date.now() / 1000 / opts.windowSec);
    // per IP ruimer (kantoren en gebouwen delen vaak één adres), per account strikt
    const keys: [string, number][] = [[`rl:${opts.name}:ip:${ip}:${bucket}`, opts.limit * 5], ...(extra ? [[`rl:${opts.name}:id:${extra.toLowerCase()}:${bucket}`, opts.limit] as [string, number]] : [])];
    for (const [key, limit] of keys) {
      const cur = parseInt((await c.env.KV.get(key)) ?? "0", 10);
      if (cur >= limit) {
        c.header("Retry-After", String(opts.windowSec));
        throw new HttpError(429, "Te veel pogingen. Probeer later opnieuw.");
      }
      await c.env.KV.put(key, String(cur + 1), { expirationTtl: opts.windowSec + 5 });
    }
    await next();
  };
}
