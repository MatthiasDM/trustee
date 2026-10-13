export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const plusMs = (ms: number) => new Date(Date.now() + ms).toISOString();

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64u(arr);
}
export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function safeFilename(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * PATCH-veilig parsen: valideert met het (partiële) schema maar houdt enkel de velden over die de client meestuurde.
 * Zonder dit vallen velden met een .default() bij elke PATCH terug op hun standaardwaarde.
 */
export function patchOf<T extends Record<string, unknown>>(schema: { parse: (v: unknown) => T }, raw: unknown): Partial<T> {
  const parsed = schema.parse(raw);
  const keys = new Set(Object.keys((raw ?? {}) as object));
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => keys.has(k))) as Partial<T>;
}
