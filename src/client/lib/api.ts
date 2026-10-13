export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: string[]) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown, isForm = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: isForm ? {} : body !== undefined ? { "Content-Type": "application/json" } : {},
    body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Fout ${res.status}`, (data as any)?.issues);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  upload: <T>(url: string, form: FormData) => request<T>("POST", url, form, true),
};

export const fmtDate = (s?: string | null, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => s ? new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", ...opts }).format(new Date(s)) : "";
export const fmtDateTime = (s?: string | null) => fmtDate(s, { dateStyle: "medium", timeStyle: "short" });
export const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
export const timeAgo = (s: string) => {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return "zonet";
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} u geleden`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d geleden`;
  return fmtDate(s);
};
