import type { Env } from "../env";
import { notifyBuilding } from "./notify";
import { attendance } from "./meeting";

/** Cron: de syndicus verwittigen wanneer de notulen van een AV 30 dagen na de vergadering nog niet bezorgd zijn (art. 3.87 §12 BW); één keer. */
export async function minutesLateReminders(env: Env) {
  const limit = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = (await env.DB.prepare("SELECT id, building_id, title, starts_at FROM meetings WHERE type IN ('av','bav') AND cancelled_at IS NULL AND starts_at < ? AND starts_at > ? AND minutes_status != 'final'").bind(limit, new Date(Date.now() - 120 * 86400_000).toISOString()).all<any>()).results;
  let n = 0;
  for (const m of rows) {
    const key = `minutes:late:${m.id}`; if (await env.KV.get(key)) continue;
    await env.KV.put(key, "1", { expirationTtl: 200 * 86400 });
    await notifyBuilding(env, { buildingId: m.building_id, type: "minutes", title: `Notulen te laat: ${m.title}`, body: "De notulen moeten binnen 30 dagen na de vergadering in het register staan en aan elke stemgerechtigde bezorgd zijn (art. 3.87 §12 BW). Maak ze nu definitief.", link: `/b/${m.building_id}/meetings`, roles: ["syndicus", "raad"] });
    n++;
  }
  return n;
}

// ---------- Ondertekening van de notulen (art. 3.87 §10 BW) ----------

/** SHA-256 van de tekst waaronder getekend wordt; een handtekening geldt enkel voor exact die tekst. */
export async function bodyHash(body: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type Capacity = "chair" | "secretary" | "chair_secretary" | "owner";
export const CAPACITY_LABEL: Record<Capacity, string> = { chair: "voorzitter", secretary: "secretaris", chair_secretary: "voorzitter en secretaris", owner: "mede-eigenaar of lasthebber" };
export interface Signer { user_id: string; name: string; capacity: Capacity; units: string[]; remote: boolean }

/**
 * Wie de notulen tekent: de voorzitter, de bij de opening aangewezen secretaris en de aanwezige mede-eigenaars of hun lasthebbers.
 * "Aanwezig" volgt de aanwezigheidslijst: de stemgerechtigde zelf (ter plaatse of vanop afstand), of bij volmacht de drager.
 */
export async function eligibleSigners(env: Env, buildingId: string, m: { id: string; chair_user_id?: string | null; secretary_user_id?: string | null }): Promise<Signer[]> {
  const att = await attendance(env, buildingId, m.id);
  const by = new Map<string, Signer>();
  for (const r of att.rows) {
    if (!r.present || !r.acting_id) continue;
    const s = by.get(r.acting_id) ?? { user_id: r.acting_id, name: "", capacity: "owner" as Capacity, units: [], remote: false };
    s.units.push(r.label); s.remote = s.remote || r.remote; by.set(r.acting_id, s);
  }
  const officer = (id: string | null | undefined, cap: "chair" | "secretary") => {
    if (!id) return;
    const s = by.get(id) ?? { user_id: id, name: "", capacity: cap as Capacity, units: [], remote: false };
    s.capacity = s.capacity === "owner" || s.capacity === cap ? cap : "chair_secretary"; by.set(id, s);
  };
  officer(m.chair_user_id, "chair"); officer(m.secretary_user_id, "secretary");
  const ids = [...by.keys()];
  if (ids.length) for (const u of (await env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; name: string }>()).results) by.get(u.id)!.name = u.name;
  const order: Record<Capacity, number> = { chair: 0, chair_secretary: 0, secretary: 1, owner: 2 };
  return [...by.values()].sort((a, b) => order[a.capacity] - order[b.capacity] || a.name.localeCompare(b.name));
}

export interface SignatureRow { user_id: string; name: string; capacity: Capacity; method: "electronic" | "paper"; signed_at: string; body_hash: string; recorded_by_name?: string | null }
export async function signaturesOf(env: Env, meetingId: string): Promise<SignatureRow[]> {
  return (await env.DB.prepare("SELECT s.user_id, u.name, s.capacity, s.method, s.signed_at, s.body_hash, r.name AS recorded_by_name FROM minutes_signatures s JOIN users u ON u.id = s.user_id LEFT JOIN users r ON r.id = s.recorded_by WHERE s.meeting_id = ? ORDER BY s.signed_at").bind(meetingId).all<SignatureRow>()).results;
}

/** Voorzitter en secretaris moeten allebei getekend hebben onder de huidige tekst. Geeft terug wie ontbreekt. */
export function missingOfficers(m: { chair_user_id?: string | null; secretary_user_id?: string | null }, sigs: SignatureRow[], hash: string): string[] {
  const ok = (id?: string | null) => !!id && sigs.some((s) => s.user_id === id && s.body_hash === hash);
  const out: string[] = [];
  if (!m.chair_user_id) out.push("er is geen voorzitter aangeduid"); else if (!ok(m.chair_user_id)) out.push("de voorzitter tekende nog niet");
  if (!m.secretary_user_id) out.push("er is geen secretaris aangeduid"); else if (!ok(m.secretary_user_id)) out.push("de secretaris tekende nog niet");
  return out;
}

/** Het blok "Ondertekening" onderaan de definitieve notulen. */
export function signatureSection(sigs: SignatureRow[], signers: Signer[], hash: string, unsignedReason?: string | null): string {
  const when = (s: string) => new Date(s).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "long", timeStyle: "short" });
  const L = ["", "## Ondertekening (art. 3.87 §10 BW)"];
  const valid = sigs.filter((s) => s.body_hash === hash);
  if (!valid.length) L.push("Deze notulen zijn niet ondertekend in Trustee.");
  for (const s of valid) L.push(`- ${s.name}, ${CAPACITY_LABEL[s.capacity] ?? s.capacity}: ${s.method === "paper" ? `handgeschreven getekend, geregistreerd${s.recorded_by_name ? ` door ${s.recorded_by_name}` : ""} op ${when(s.signed_at)}` : `elektronisch getekend in Trustee op ${when(s.signed_at)}`}`);
  const open = signers.filter((x) => !valid.some((s) => s.user_id === x.user_id));
  if (open.length) L.push(`Niet getekend: ${open.map((x) => `${x.name} (${CAPACITY_LABEL[x.capacity]})`).join(", ")}.`);
  if (unsignedReason) L.push(`Definitief gemaakt zonder de handtekening van voorzitter of secretaris. Reden opgegeven door de syndicus: ${unsignedReason}`);
  L.push(`Controlegetal van de ondertekende tekst (SHA-256): ${hash}`);
  return L.join("\n");
}
