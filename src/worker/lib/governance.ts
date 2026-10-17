import type { BuildingCtx, Env } from "../env";
import { isBoard, isManager } from "./auth";

/**
 * Noodbeheer volgens Boek 3 BW (tekst geverifieerd op 2026-10-16):
 * - art. 3.89 §7: de AV kan de syndicus een voorlopig syndicus toevoegen voor een welbepaalde duur of welbepaalde doeleinden;
 * - art. 3.89 §8: bij verhindering of in gebreke blijven wijst de rechter op verzoek van iedere mede-eigenaar een voorlopig syndicus aan;
 * - art. 3.89 §6: bevoegdheidsoverdracht enkel met toestemming van de AV, beperkt in duur of doel;
 * - art. 3.87 §2 lid 3: roept de syndicus niet op binnen 30 dagen na een 1/5-verzoek, dan mag een ondertekenaar zelf bijeenroepen;
 * - art. 3.87 §2 lid 4: bij gebreke van een syndicus roept de raad, anders de voorzitter van de laatste AV, anders 1/5 van de aandelen de AV bijeen om een syndicus aan te wijzen.
 */

/** SQL: heeft gebruiker ?1 vandaag een actief mandaat als (voorlopig) syndicus in gebouw b? */
export const ACTING_SYNDICUS_SQL = "EXISTS(SELECT 1 FROM mandates md WHERE md.building_id = b.id AND md.user_id = ?1 AND md.organ IN ('syndicus','voorlopig_syndicus','voorlopig_bewindvoerder') AND md.start_date <= date('now') AND md.end_date >= date('now'))";

/** Is er een syndicus (lid met rol syndicus, kantoor, of actief mandaat)? Zo niet geldt art. 3.87 §2 lid 4. */
export async function hasSyndicus(env: Env, buildingId: string): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT (
      EXISTS(SELECT 1 FROM building_members bm WHERE bm.building_id = ?1 AND bm.role = 'syndicus')
      OR EXISTS(SELECT 1 FROM org_members om JOIN buildings b ON b.org_id = om.org_id WHERE b.id = ?1)
      OR EXISTS(SELECT 1 FROM mandates md WHERE md.building_id = ?1 AND md.organ IN ('syndicus','voorlopig_syndicus','voorlopig_bewindvoerder') AND md.start_date <= date('now') AND md.end_date >= date('now'))
    ) AS present`).bind(buildingId).first<{ present: number }>();
  return !!r?.present;
}

/** Voorzitter van de laatste (voorbije) algemene vergadering. */
export async function lastChairId(env: Env, buildingId: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT chair_user_id FROM meetings WHERE building_id = ? AND type IN ('av','bav') AND starts_at < ? AND cancelled_at IS NULL ORDER BY starts_at DESC LIMIT 1").bind(buildingId, new Date().toISOString()).first<{ chair_user_id: string | null }>();
  return r?.chair_user_id ?? null;
}

export interface ConveneRight { basis: "request_overdue" | "no_syndicus"; request_id: string | null; text: string }

/**
 * Mag deze mede-eigenaar (geen orgaan) zelf een AV bijeenroepen? Geeft de wettelijke grond, of null.
 * - ondertekenaar van een 1/5-verzoek waarvan de termijn van 30 dagen verstreken is zonder bijeenroeping;
 * - bij gebreke van een syndicus: voorzitter van de laatste AV, of ondertekenaar van een bereikt verzoek "syndicus aanwijzen".
 */
export async function ownerConveneRight(env: Env, b: BuildingCtx, userId: string): Promise<ConveneRight | null> {
  const today = new Date().toISOString().slice(0, 10);
  const reqs = (await env.DB.prepare("SELECT r.id, r.purpose, r.deadline FROM meeting_requests r JOIN meeting_request_signatures s ON s.request_id = r.id AND s.user_id = ?2 WHERE r.building_id = ?1 AND r.status = 'threshold_reached' ORDER BY r.threshold_reached_at").bind(b.id, userId).all<{ id: string; purpose: string; deadline: string | null }>()).results;
  const present = await hasSyndicus(env, b.id);
  if (!present) {
    if (b.role === "raad" || (await lastChairId(env, b.id)) === userId) return { basis: "no_syndicus", request_id: reqs.find((r) => r.purpose === "appoint_syndicus")?.id ?? null, text: "Bij gebreke van een syndicus (art. 3.87 §2, lid 4 BW)" };
    const appoint = reqs.find((r) => r.purpose === "appoint_syndicus");
    if (appoint) return { basis: "no_syndicus", request_id: appoint.id, text: "Bij gebreke van een syndicus, op verzoek van mede-eigenaars met minstens 1/5 van de aandelen (art. 3.87 §2, lid 4 BW)" };
  }
  const overdue = reqs.find((r) => r.deadline && r.deadline < today);
  if (overdue) return { basis: "request_overdue", request_id: overdue.id, text: "De syndicus gaf geen gevolg aan het verzoek van mede-eigenaars met minstens 1/5 van de aandelen binnen 30 dagen (art. 3.87 §2, lid 3 BW)" };
  return null;
}

/** Wie mag een vergadering beheren (bewerken, oproepen, aanwezigheden, stemmen registreren, notulen): de organen, of de mede-eigenaar die ze wettig zelf bijeenriep. */
export function canManageMeeting(b: BuildingCtx, userId: string, m: { convened_by_owners?: number; created_by?: string | null }, opts: { finalize?: boolean } = {}): boolean {
  if (opts.finalize ? isManager(b.role) : isBoard(b.role)) return true;
  return !!m.convened_by_owners && m.created_by === userId;
}

/** Wie mag een (voorlopig) syndicus registreren als de organen ontbreken: raad, voorzitter laatste AV, of ondertekenaar van een bereikt verzoek "syndicus aanwijzen". */
export async function canRegisterSyndicus(env: Env, b: BuildingCtx, userId: string): Promise<boolean> {
  if (isBoard(b.role)) return true;
  if (await hasSyndicus(env, b.id)) return false;
  if ((await lastChairId(env, b.id)) === userId) return true;
  const r = await env.DB.prepare("SELECT 1 FROM meeting_requests r JOIN meeting_request_signatures s ON s.request_id = r.id AND s.user_id = ?2 WHERE r.building_id = ?1 AND r.purpose = 'appoint_syndicus' AND r.status IN ('threshold_reached','fulfilled')").bind(b.id, userId).first();
  return !!r;
}

const SYNDICUS_ORGANS = ["syndicus", "voorlopig_syndicus"]; const SUPERVISORY = ["raad", "commissaris"];
/**
 * Onverenigbaarheid (art. 3.89 §9 BW): binnen dezelfde VME mag een syndicus niet tegelijk lid van de raad van mede-eigendom
 * of commissaris van de rekeningen zijn. Controleert overlappende mandaten en de rol van het lid. Geeft een foutboodschap of null.
 */
export async function organConflict(env: Env, buildingId: string, userId: string, organ: string, start: string, end: string, excludeMandateId?: string): Promise<string | null> {
  const opposite = SYNDICUS_ORGANS.includes(organ) ? SUPERVISORY : SUPERVISORY.includes(organ) ? SYNDICUS_ORGANS : null;
  if (!opposite) return null;
  const hit = await env.DB.prepare(`SELECT organ FROM mandates WHERE building_id = ? AND user_id = ? AND organ IN (${opposite.map(() => "?").join(",")}) AND start_date <= ? AND end_date >= ? AND id != ? LIMIT 1`).bind(buildingId, userId, ...opposite, end, start, excludeMandateId ?? "").first<{ organ: string }>();
  const member = await env.DB.prepare("SELECT role FROM building_members WHERE building_id = ? AND user_id = ?").bind(buildingId, userId).first<{ role: string }>();
  const roleClash = SUPERVISORY.includes(organ) ? member?.role === "syndicus" : SUPERVISORY.includes(member?.role ?? "");
  if (!hit && !roleClash) return null;
  const what = (o: string) => ({ syndicus: "syndicus", voorlopig_syndicus: "voorlopig syndicus", raad: "lid van de raad van mede-eigendom", commissaris: "commissaris van de rekeningen" } as Record<string, string>)[o] ?? o;
  return `Onverenigbaar: deze persoon is ${what(hit?.organ ?? member!.role)} en kan in dezelfde VME niet tegelijk ${what(organ)} zijn (art. 3.89 §9 BW)`;
}
