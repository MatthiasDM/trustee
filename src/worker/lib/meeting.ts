import type { Env } from "../env";
import { HttpError } from "./util";
import { suspendedFor, votingUnits, weightOf } from "./voting";

/** Sleutel voor een volmachtdrager zonder account: zijn naam binnen de vergadering (hoofdletters, accenten en spaties tellen niet). */
export const externalHolderId = (name: string) => `ext:${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
export const isExternalHolder = (id: string | null | undefined) => !!id && id.startsWith("ext:");

export interface AttendanceRow { unit_id: string; label: string; shares: number; owner_ids: string[]; owner_names: string; status: "attending" | "proxy" | "absent" | "unknown" | "suspended"; holder_name?: string | null; holder_id?: string | null; present: boolean; /** neemt op afstand deel (art. 3.87 §1) */ remote: boolean; /** wie de stem ter plaatse of op afstand uitbrengt: de stemgerechtigde, of bij volmacht de drager */ acting_id: string | null; split: boolean; suspended: boolean; voter_id: string | null; voter_name: string | null }

/**
 * Aanwezigheid per kavel en quorum (art. 3.87 §5). Een kavel is vertegenwoordigd door wie haar stemrecht uitoefent:
 * de enige eigenaar, of bij gesplitste eigendom de lasthebber (art. 3.87 §1, lid 2). Zonder lasthebber is de kavel geschorst.
 */
export async function attendance(env: Env, buildingId: string, meetingId: string) {
  const vunits = await votingUnits(env, buildingId);
  const rsvps = (await env.DB.prepare("SELECT r.user_id, r.status, r.proxy_user_id, r.proxy_name, h.name AS holder_name FROM meeting_rsvps r LEFT JOIN users h ON h.id = r.proxy_user_id WHERE r.meeting_id = ?").bind(meetingId).all()).results as any[];
  const meeting = await env.DB.prepare("SELECT is_second_call FROM meetings WHERE id = ?").bind(meetingId).first<any>();
  const rows: AttendanceRow[] = vunits.map((u) => {
    const r = u.voter_id ? rsvps.find((x) => x.user_id === u.voter_id) : null;
    // volmachtdrager: een lid (account) of een derde op naam
    const holderId: string | null = r?.status === "proxy" ? r.proxy_user_id ?? (r.proxy_name ? externalHolderId(r.proxy_name) : null) : null;
    const holderName: string | null = r?.status === "proxy" ? r.holder_name ?? r.proxy_name ?? null : null;
    const status = u.suspended ? "suspended" : !r ? "unknown" : r.status === "attending" || r.status === "remote" ? "attending" : r.status === "proxy" && holderId ? "proxy" : r.status === "absent" ? "absent" : "unknown";
    const ownerNames = u.owners.map((o) => o.name).join(", ");
    return { unit_id: u.unit_id, label: u.label, shares: u.shares, owner_ids: u.owners.map((o) => o.user_id), owner_names: u.split ? `${ownerNames}${u.voter_name ? ` · lasthebber ${u.voter_name}` : " · geen lasthebber"}` : ownerNames, status, holder_name: status === "proxy" ? holderName : null, holder_id: status === "proxy" ? holderId : null, present: status === "attending" || status === "proxy", remote: status === "attending" ? r?.status === "remote" : status === "proxy" ? rsvps.some((x) => x.user_id === r?.proxy_user_id && x.status === "remote") : false, acting_id: status === "proxy" ? holderId : status === "attending" ? u.voter_id : null, split: u.split, suspended: u.suspended, voter_id: u.voter_id, voter_name: u.voter_name };
  });
  const withOwner = rows.filter((r) => r.owner_ids.length);
  const totalShares = withOwner.reduce((s, r) => s + r.shares, 0);
  const presentShares = withOwner.filter((r) => r.present).reduce((s, r) => s + r.shares, 0);
  // "meer dan de helft van de mede-eigenaars": één deelnemer per stemgerechtigde persoon; een geschorste kavel telt als één afwezige deelnemer
  const key = (r: AttendanceRow) => r.voter_id ?? `kavel:${r.unit_id}`;
  const allOwners = new Set(withOwner.map(key)); const presentOwners = new Set(withOwner.filter((r) => r.present).map(key));
  const ruleA = presentOwners.size > allOwners.size / 2 && presentShares >= totalShares / 2;
  const ruleB = presentShares > totalShares * 0.75;
  const second = !!meeting?.is_second_call;
  const suspended = withOwner.filter((r) => r.suspended).map((r) => r.label);
  return { rows, suspended_units: suspended, quorum: { total_owners: allOwners.size, present_owners: presentOwners.size, total_shares: totalShares, present_shares: presentShares, rule_a: ruleA, rule_b: ruleB, second_call: second, reached: second || ruleA || ruleB, explanation: second ? "Tweede bijeenroeping: geen quorum vereist (art. 3.87 §5)." : ruleA ? "Meer dan de helft van de mede-eigenaars aanwezig of vertegenwoordigd, met minstens de helft van de aandelen." : ruleB ? "Meer dan 3/4 van de aandelen aanwezig of vertegenwoordigd." : "Quorum niet bereikt: nodig is meer dan de helft van de eigenaars met minstens de helft van de aandelen, of meer dan 3/4 van de aandelen. Anders een tweede AV na minstens 15 dagen, zonder quorumvereiste." } };
}

/**
 * Volmachtregels art. 3.87 §7: de lasthebber is "al dan niet lid van de algemene vergadering" (een lid met account of een derde op naam);
 * de syndicus kan niet als lasthebber optreden; niemand aanvaardt meer dan drie volmachten, tenzij eigen en gevolmachtigde stemmen samen
 * hoogstens 10 % van alle stemmen zijn; geen volmacht aan jezelf.
 */
export async function validateProxy(env: Env, buildingId: string, meetingId: string, grantorId: string, holder: { user_id?: string | null; name?: string | null }) {
  const vunits = await votingUnits(env, buildingId);
  if (weightOf(vunits, grantorId) <= 0 && suspendedFor(vunits, grantorId).length) throw new HttpError(400, `Voor kavel ${suspendedFor(vunits, grantorId).map((u) => u.label).join(", ")} geeft enkel de lasthebber een volmacht (art. 3.87 §1, lid 2 BW)`);
  let holderKey: string; let holderName: string; let ownShares = 0;
  if (holder.user_id) {
    if (holder.user_id === grantorId) throw new HttpError(400, "Je kan jezelf geen volmacht geven");
    const h = await env.DB.prepare("SELECT bm.role, u.name FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.user_id = ?").bind(buildingId, holder.user_id).first<any>();
    if (!h) throw new HttpError(400, "Volmachtdrager is geen lid van dit gebouw; vul voor iemand van buiten de mede-eigendom zijn naam in");
    if (h.role === "syndicus") throw new HttpError(400, "De syndicus mag geen volmachten dragen (art. 3.87 §7 BW)");
    holderKey = holder.user_id; holderName = h.name; ownShares = weightOf(vunits, holder.user_id);
  } else {
    const name = (holder.name ?? "").trim();
    if (name.length < 3) throw new HttpError(400, "Vul de volledige naam van de volmachtdrager in: de volmacht vermeldt de naam van de lasthebber (art. 3.87 §7 BW)");
    holderKey = externalHolderId(name); holderName = name;
    const people = (await env.DB.prepare("SELECT bm.user_id, bm.role, u.name FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ?").bind(buildingId).all<{ user_id: string; role: string; name: string }>()).results;
    const same = people.filter((p) => externalHolderId(p.name) === holderKey);
    if (same.some((p) => p.role === "syndicus")) throw new HttpError(400, "De syndicus mag geen volmachten dragen (art. 3.87 §7 BW)");
    if (same.some((p) => p.user_id === grantorId)) throw new HttpError(400, "Je kan jezelf geen volmacht geven");
    if (same.length) throw new HttpError(400, `${same[0].name} is lid van dit gebouw: kies hem of haar in de lijst in plaats van de naam in te vullen`);
  }
  // alle volmachten van deze vergadering voor dezelfde drager, behalve die van de volmachtgever zelf
  const others = ((await env.DB.prepare("SELECT user_id, proxy_user_id, proxy_name FROM meeting_rsvps WHERE meeting_id = ? AND status = 'proxy' AND user_id != ?").bind(meetingId, grantorId).all<{ user_id: string; proxy_user_id: string | null; proxy_name: string | null }>()).results)
    .filter((r) => (r.proxy_user_id ?? (r.proxy_name ? externalHolderId(r.proxy_name) : null)) === holderKey);
  if (others.length >= 3) {
    const total = (await env.DB.prepare("SELECT COALESCE(SUM(shares),0) AS s FROM units WHERE building_id = ?").bind(buildingId).first<any>())?.s ?? 0;
    const sum = ownShares + weightOf(vunits, grantorId) + others.reduce((a, r) => a + weightOf(vunits, r.user_id), 0);
    if (total > 0 && sum / total > 0.10) throw new HttpError(400, `${holderName} draagt al 3 volmachten; meer mag enkel als eigen en gevolmachtigde stemmen samen hoogstens 10 % van de aandelen zijn (art. 3.87 §7 BW)`);
  }
}

export const MAJ: Record<string, { label: string; frac: number }> = { none: { label: "peiling", frac: 0 }, simple: { label: "volstrekte meerderheid", frac: 0.5 }, two_thirds: { label: "2/3 meerderheid", frac: 2 / 3 }, four_fifths: { label: "4/5 meerderheid", frac: 0.8 }, unanimous: { label: "eenparigheid", frac: 1 } };

/** Meerderheidstoets art. 3.88: onthoudingen tellen niet mee; eenparigheid = alle stemgerechtigde aandelen vóór. */
export function majorityReached(required: string, votesFor: number, votesAgainst: number, totalEligibleShares: number): { reached: boolean; pct: number } {
  const cast = votesFor + votesAgainst;
  const pct = cast > 0 ? votesFor / cast : 0;
  if (required === "none") return { reached: votesFor > votesAgainst, pct };
  if (required === "unanimous") return { reached: votesAgainst === 0 && votesFor >= totalEligibleShares - 0.001 && votesFor > 0, pct };
  if (required === "simple") return { reached: cast > 0 && votesFor > votesAgainst, pct };
  return { reached: cast > 0 && pct >= MAJ[required].frac - 1e-9, pct };
}

export interface TallyResult {
  votes_for: number; votes_against: number; votes_abstain: number; voters_for: number; voters_against: number; voters_abstain: number;
  eligible: number; reached: boolean; pct: number; dissenters: string[];
  capped: { person_id: string; name: string; had: number; counted: number }[];
  excluded: { unit_id: string; label: string; name: string }[];
  invalid: { unit_id: string; label: string; reason: string }[];
  missed_by_absence?: boolean;
}

/**
 * Telt een stemming tijdens de AV per kavel, met
 * - stemplafond (art. 3.87 §7, lid 4): niemand stemt, ook niet als lastgever of lasthebber, voor meer stemmen dan alle andere aanwezige of
 *   vertegenwoordigde mede-eigenaars samen; het teveel wordt evenredig over zijn keuzes geschrapt;
 * - belangenconflict (art. 3.87 §9): wie in conflictIds staat, neemt niet deel, persoonlijk noch bij volmacht: zijn eigen kavels en de kavels
 *   waarvoor hij volmacht draagt tellen niet mee;
 * - geschorste kavels (gesplitste eigendom zonder lasthebber) kunnen niet stemmen.
 */
/**
 * opts.weights (art. 3.87 §6, lid 2): als de lasten van een gemeenschappelijk deel uitsluitend ten laste van bepaalde mede-eigenaars zijn, stemmen
 * enkel zij, elk naar zijn aandeel in die lasten (gewicht uit de verdeelsleutel). opts.followup (art. 3.88 §4): nieuwe AV na een eenparigheid die
 * door afwezigheid niet bereikt werd; eenparigheid van de aanwezige of vertegenwoordigde mede-eigenaars volstaat.
 */
export function tally(rows: AttendanceRow[], votes: { unit_id: string; choice: string }[], required: string, conflictIds: string[], names: Record<string, string>, opts: { weights?: Map<string, number>; followup?: boolean } = {}): TallyResult {
  if (opts.weights) rows = rows.filter((r) => (opts.weights!.get(r.unit_id) ?? 0) > 0).map((r) => ({ ...r, shares: opts.weights!.get(r.unit_id)! }));
  const conflict = new Set(conflictIds);
  const invalid: TallyResult["invalid"] = []; const excluded: TallyResult["excluded"] = [];
  type E = { person: string; shares: number; choice: string; row: AttendanceRow };
  const entries: E[] = [];
  for (const v of votes) {
    const r = rows.find((x) => x.unit_id === v.unit_id); if (!r || !r.owner_ids.length) continue;
    if (!["for", "against", "abstain"].includes(v.choice)) continue;
    if (r.suspended) { invalid.push({ unit_id: r.unit_id, label: r.label, reason: "deelnamerecht geschorst, geen lasthebber (art. 3.87 §1, lid 2 BW)" }); continue; }
    const acting = r.status === "proxy" && r.holder_id ? r.holder_id : r.voter_id;
    const hit = [acting, r.voter_id].find((p) => p && conflict.has(p));
    if (hit) { excluded.push({ unit_id: r.unit_id, label: r.label, name: names[hit] ?? hit }); continue; }
    entries.push({ person: acting ?? `kavel:${r.unit_id}`, shares: r.shares, choice: v.choice, row: r });
  }
  const per = new Map<string, number>(); for (const e of entries) per.set(e.person, (per.get(e.person) ?? 0) + e.shares);
  const total = [...per.values()].reduce((s, x) => s + x, 0);
  const factor = new Map<string, number>(); const capped: TallyResult["capped"] = [];
  for (const [p, t] of per) { const others = total - t; if (t > others && per.size > 1) { factor.set(p, others / t); capped.push({ person_id: p, name: names[p] ?? p, had: t, counted: Math.round(others * 100) / 100 }); } }
  let vf = 0, va = 0, vab = 0, nf = 0, na = 0, nab = 0; const dissenters: string[] = [];
  for (const e of entries) {
    const w = e.shares * (factor.get(e.person) ?? 1);
    if (e.choice === "for") { vf += w; nf++; } else if (e.choice === "against") { va += w; na++; dissenters.push(`${e.row.split ? `${e.row.voter_name} (lasthebber)` : e.row.owner_names} (kavel ${e.row.label})`); } else { vab += w; nab++; }
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const eligibleRows = rows.filter((r) => r.owner_ids.length && !excluded.some((x) => x.unit_id === r.unit_id) && (!opts.followup || votes.some((v) => v.unit_id === r.unit_id && v.choice !== "absent")));
  const eligible = eligibleRows.reduce((s, r) => s + r.shares, 0);
  let res = majorityReached(required, vf, va, eligible);
  // eenparigheid: elke niet-uitgesloten kavel stemde vóór (een stemplafond verandert daar niets aan)
  if (required === "unanimous") res = { reached: eligibleRows.length > 0 && eligibleRows.every((r) => votes.find((v) => v.unit_id === r.unit_id)?.choice === "for"), pct: res.pct };
  // eenparigheid enkel gemist door afwezigen: niemand van de aanwezigen stemde tegen of onthield zich (art. 3.88 §4)
  const missedByAbsence = required === "unanimous" && !res.reached && !opts.followup && va === 0 && vab === 0 && vf > 0;
  return { missed_by_absence: missedByAbsence, votes_for: r2(vf), votes_against: r2(va), votes_abstain: r2(vab), voters_for: nf, voters_against: na, voters_abstain: nab, eligible, reached: res.reached, pct: res.pct, dissenters, capped, excluded, invalid };
}

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
const nl = (s: string) => esc(s).replace(/\n/g, "<br>");

/** Notulen als HTML-document (bewaard in Documenten, verzonden binnen 30 dagen, art. 3.87 §12). */
export function renderMinutesHtml(title: string, buildingName: string, bodyMarkdownish: string) {
  const html = bodyMarkdownish.split("\n").map((line) => {
    if (/^# /.test(line)) return `<h1>${esc(line.slice(2))}</h1>`;
    if (/^## /.test(line)) return `<h2>${esc(line.slice(3))}</h2>`;
    if (/^### /.test(line)) return `<h3>${esc(line.slice(4))}</h3>`;
    if (/^- /.test(line)) return `<li>${esc(line.slice(2))}</li>`;
    if (!line.trim()) return "";
    return `<p>${esc(line)}</p>`;
  }).join("\n").replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;line-height:1.5;color:#111}h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #ccc}h3{font-size:15px}li{margin:2px 0}.meta{color:#555;font-size:13px}</style></head><body><p class="meta">${esc(buildingName)}</p>${html}</body></html>`;
}
export { nl };
