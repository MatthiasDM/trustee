/** Kleine HTTP-client met cookie-jar per gebruiker voor scenariotests tegen de testomgeving. */
export const BASE = process.env.TEST_BASE ?? "http://127.0.0.1:5199";
export const B = "b-zeezicht";
export const PW = "wachtwoord123";

export class Client {
  cookie = "";
  constructor(public label = "anon") {}
  async raw(method: string, path: string, body?: unknown, form?: FormData) {
    const send = () => fetch(BASE + path, { method, headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined && !form ? { "content-type": "application/json" } : {}) }, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    let res = await send();
    // De Vite-devserver geeft sporadisch een HTML-500 (herladen van de worker); dat is geen API-fout: één keer opnieuw proberen.
    if (res.status === 500 && (res.headers.get("content-type") ?? "").includes("text/html") && !form) { await new Promise((r) => setTimeout(r, 700)); res = await send(); }
    const sc = res.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return res;
  }
  async json<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> { const r = await this.raw(method, path, body); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, data: (ct.includes("json") ? await r.json() : await r.text()) as T }; }
  get = <T = any>(p: string) => this.json<T>("GET", p);
  post = <T = any>(p: string, b?: unknown) => this.json<T>("POST", p, b);
  patch = <T = any>(p: string, b?: unknown) => this.json<T>("PATCH", p, b);
  put = <T = any>(p: string, b?: unknown) => this.json<T>("PUT", p, b);
  del = <T = any>(p: string, b?: unknown) => this.json<T>("DELETE", p, b);
  async upload<T = any>(p: string, fields: Record<string, string>, file: { name: string; content: string | Uint8Array; type?: string }) { const fd = new FormData(); fd.append("file", new File([file.content as any], file.name, { type: file.type ?? "application/octet-stream" })); for (const [k, v] of Object.entries(fields)) fd.append(k, v); const r = await this.raw("POST", p, undefined, fd); return { status: r.status, data: (await r.json()) as T }; }
  async login(email: string, password = PW) { const r = await this.post("/api/auth/login", { email, password }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.data)}`); return this; }
}
export const as = async (user: string) => new Client(user).login(`${user}@demo.be`);
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
