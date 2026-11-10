// Dun doorstuur-Worker voor de publieke demo: stopt te grote aanvragen en te veel verkeer aan de rand, vóór de thuisserver.
const MAX_BODY = 5 * 1024 * 1024 + 64 * 1024;
const offline = () => new Response(`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trustee demo</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#334155"><h1 style="color:#0f172a">De demo is even niet bereikbaar</h1><p>De server staat tijdelijk uit. Probeer later opnieuw, of bekijk de <a href="https://github.com/MatthiasDM/trustee">broncode op GitHub</a>.</p></body></html>`, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "300" } });

// De thuisserver wordt bereikt via de Workers VPC-binding ORIGIN (tunnel trustee-demo → 127.0.0.1:8799).
// Die gaat langs de ingress-regels van de tunnel heen, dus de interne paden worden hier geweigerd.
const ORIGIN = "http://127.0.0.1:8799";
const INTERN = /^\/(__scheduled|cdn-cgi\/)/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.RL_ALL.limit({ key: ip })).success) return new Response("Te veel aanvragen", { status: 429, headers: { "retry-after": "60" } });
    if (INTERN.test(url.pathname)) return new Response("Niet gevonden", { status: 404 });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const len = request.headers.get("content-length");
      if (request.body && len === null) return new Response("Lengte ontbreekt", { status: 411 });
      if (Number(len ?? 0) > MAX_BODY) return Response.json({ error: "Bestand te groot voor de demo (max 5 MB)" }, { status: 413 });
    }
    // Bestanden met hash in de naam: zelf cachen, want cf.cacheEverything werkt niet op een VPC-binding.
    const asset = request.method === "GET" && url.pathname.startsWith("/assets/");
    if (asset) { const hit = await caches.default.match(request); if (hit) return hit; }
    const target = new URL(url.pathname + url.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("x-edge-secret", env.EDGE_SECRET);
    headers.set("x-demo-client-ip", ip);
    const init = { method: request.method, headers, body: request.body, redirect: "manual" };
    try {
      let res = await env.ORIGIN.fetch(target, init);
      if (res.status >= 520 || res.status === 502) return offline();
      if (asset && res.status === 200) {
        res = new Response(res.body, res);
        res.headers.set("cache-control", "public, max-age=86400, immutable");
        ctx.waitUntil(caches.default.put(request, res.clone()));
      }
      return res;
    } catch { return offline(); }
  },
};
