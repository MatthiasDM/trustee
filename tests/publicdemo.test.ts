import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { assertDemoUpload, bodyTooLarge, DEMO_LIMITS, isBlockedInDemo, publicDemoGuard } from "../src/worker/lib/publicdemo";

const headers = (h: Record<string, string>) => new Headers(h);
const app = new Hono<any>();
app.use("*", publicDemoGuard);
app.all("*", (c) => c.json({ ok: true }));

describe("publieke demo: toegang", () => {
  it("blokkeert echte accounts en nieuwe tenants, niet de demo zelf", () => {
    for (const p of ["/api/auth/register", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/totp/setup", "/api/buildings", "/api/orgs/x/members", "/api/notifications/push/subscribe", "/api/buildings/b1/handover", "/api/buildings/handover/accept"]) expect(isBlockedInDemo("POST", p), p).toBe(true);
    for (const p of ["/api/demo/start", "/api/demo/switch", "/api/auth/logout", "/api/buildings/b1/documents"]) expect(isBlockedInDemo("POST", p), p).toBe(false);
    expect(isBlockedInDemo("GET", "/api/buildings")).toBe(false);
  });
  it("doet niets zonder DEMO_ONLY", async () => {
    expect((await app.request("/api/auth/register", { method: "POST" }, {})).status).toBe(200);
  });
  it("geeft 403 op geblokkeerde routes en 429 boven de limiet", async () => {
    const limiter = { limit: vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValue({ success: false }) };
    const env = { DEMO_ONLY: "1", RL_WRITE: limiter, RL_READ: limiter };
    expect((await app.request("/api/auth/register", { method: "POST" }, env)).status).toBe(403);
    expect((await app.request("/api/demo/start", { method: "POST" }, env)).status).toBe(200);
    const r = await app.request("/api/demo/start", { method: "POST" }, env);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });
});

describe("publieke demo: grootte", () => {
  it("weigert grote aanvragen vooraf", () => {
    expect(bodyTooLarge("POST", headers({ "content-type": "application/json", "content-length": String(DEMO_LIMITS.jsonBytes + 1) }))?.status).toBe(413);
    expect(bodyTooLarge("POST", headers({ "content-type": "multipart/form-data; boundary=x", "content-length": String(DEMO_LIMITS.fileBytes + 100_000) }))?.status).toBe(413);
    expect(bodyTooLarge("POST", headers({ "content-type": "multipart/form-data; boundary=x", "content-length": String(DEMO_LIMITS.fileBytes) }))).toBeNull();
    expect(bodyTooLarge("POST", headers({ "transfer-encoding": "chunked" }))?.status).toBe(411);
    expect(bodyTooLarge("POST", headers({}))).toBeNull();
    expect(bodyTooLarge("GET", headers({ "content-length": "999999999" }))).toBeNull();
  });
});

describe("publieke demo: uploads", () => {
  const envWith = (n: number, bytes: number, total = bytes) => ({ DEMO_ONLY: "1", DB: { prepare: (sql: string) => { const first = async () => (sql.includes("building_id") ? { n, bytes } : { bytes: total }); return { first, bind: () => ({ first }) }; } } }) as any;
  const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);
  it("laat een gewoon document toe", async () => { await expect(assertDemoUpload(envWith(1, 10), "b", file("a.pdf"))).resolves.toBeUndefined(); });
  it("weigert video, archieven en svg", async () => { for (const n of ["a.mp4", "a.zip", "a.svg"]) await expect(assertDemoUpload(envWith(0, 0), "b", file(n))).rejects.toMatchObject({ status: 415 }); });
  it("weigert te veel documenten en een volle opslag", async () => {
    await expect(assertDemoUpload(envWith(DEMO_LIMITS.buildingDocuments, 0), "b", file("a.pdf"))).rejects.toMatchObject({ status: 413 });
    await expect(assertDemoUpload(envWith(1, DEMO_LIMITS.buildingBytes), "b", file("a.pdf"))).rejects.toMatchObject({ status: 413 });
    await expect(assertDemoUpload(envWith(1, 0, DEMO_LIMITS.totalBytes), "b", file("a.pdf"))).rejects.toMatchObject({ status: 503 });
  });
  it("telt de oude versie niet mee bij een vervanging", async () => { await expect(assertDemoUpload(envWith(DEMO_LIMITS.buildingDocuments, DEMO_LIMITS.buildingBytes), "b", file("a.pdf"), 100)).resolves.toBeUndefined(); });
  it("doet niets zonder DEMO_ONLY", async () => { await expect(assertDemoUpload({} as any, "b", file("a.mp4"))).resolves.toBeUndefined(); });
});
