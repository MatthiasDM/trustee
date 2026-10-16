import type { Env } from "../env";

/**
 * Wie oefent het stemrecht van een kavel uit? (art. 3.87 §1, lid 2 BW)
 * - één eigenaar met volle eigendom: die eigenaar;
 * - gesplitste eigendom (meerdere titularissen, of een recht dat geen volle eigendom is): enkel de aangewezen lasthebber;
 *   zolang er geen lasthebber is, is het deelnamerecht van de kavel geschorst.
 * Het stemgewicht is altijd het volle aandeel van de kavel; het wordt niet over de titularissen verdeeld.
 */
export const RIGHT_LABELS: Record<string, string> = { vol: "volle eigendom", blote_eigendom: "blote eigendom", vruchtgebruik: "vruchtgebruik", erfpacht: "erfpacht", opstal: "opstal", gebruik_bewoning: "gebruik of bewoning" };

export interface VotingUnit {
  unit_id: string; label: string; shares: number;
  owners: { user_id: string; name: string; share_pct: number; right_type: string }[];
  split: boolean; voter_id: string | null; voter_name: string | null; suspended: boolean;
}

export async function votingUnits(env: Env, buildingId: string): Promise<VotingUnit[]> {
  const units = (await env.DB.prepare("SELECT un.id, un.label, un.shares, un.representative_user_id, ru.name AS rep_name, (SELECT 1 FROM building_members bm WHERE bm.building_id = un.building_id AND bm.user_id = un.representative_user_id AND bm.role NOT IN ('huurder','syndicus')) AS rep_ok FROM units un LEFT JOIN users ru ON ru.id = un.representative_user_id WHERE un.building_id = ? ORDER BY un.label").bind(buildingId).all()).results as any[];
  const owners = (await env.DB.prepare("SELECT uo.unit_id, uo.user_id, uo.share_pct, uo.right_type, u.name FROM unit_owners uo JOIN users u ON u.id = uo.user_id JOIN units un ON un.id = uo.unit_id WHERE un.building_id = ? ORDER BY u.name").bind(buildingId).all()).results as any[];
  return units.map((u) => {
    const os = owners.filter((o) => o.unit_id === u.id).map((o) => ({ user_id: o.user_id, name: o.name, share_pct: o.share_pct, right_type: o.right_type ?? "vol" }));
    const split = os.length > 1 || os.some((o) => o.right_type !== "vol");
    const rep = split && u.representative_user_id && u.rep_ok ? { id: u.representative_user_id as string, name: u.rep_name as string } : null;
    const voter = !os.length ? null : split ? rep : { id: os[0].user_id, name: os[0].name };
    return { unit_id: u.id, label: u.label, shares: u.shares, owners: os, split, voter_id: voter?.id ?? null, voter_name: voter?.name ?? null, suspended: os.length > 0 && !voter };
  });
}

/** Stemgewicht van één persoon: som van de aandelen van de kavels waarvoor hij stemt (als enige eigenaar of als lasthebber). */
export function weightOf(units: VotingUnit[], userId: string): number {
  return units.filter((u) => u.voter_id === userId).reduce((s, u) => s + u.shares, 0);
}
/** Is deze persoon titularis van een kavel waarvan het stemrecht geschorst is of door een ander wordt uitgeoefend? */
export function suspendedFor(units: VotingUnit[], userId: string): VotingUnit[] {
  return units.filter((u) => u.owners.some((o) => o.user_id === userId) && u.voter_id !== userId);
}
/** Stemgerechtigde personen (voor schriftelijke besluitvorming en quorum): één per kavel, de lasthebber of de enige eigenaar. */
export function voterIds(units: VotingUnit[]): string[] { return [...new Set(units.map((u) => u.voter_id).filter(Boolean) as string[])]; }
