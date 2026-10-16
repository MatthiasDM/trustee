/**
 * Termijnen bij een beslissing van de algemene vergadering (tekst geverifieerd 2026-10-16):
 * - art. 3.92 §3: iedere mede-eigenaar kan binnen 4 maanden na de AV de vernietiging of wijziging vragen van een onregelmatige,
 *   bedrieglijke of onrechtmatige beslissing die hem persoonlijk nadeel oplevert;
 * - art. 3.93 §5: wie het gebouw bewoont zonder stemrecht, binnen 2 maanden na de kennisgeving en uiterlijk 4 maanden na de AV;
 * - art. 3.92 §1 (bij art. 3.88 §1, 2°, h): volledige afbraak en heropbouw zonder eenparigheid van alle stemgerechtigden: de VME moet zich
 *   binnen 4 maanden tot de vrederechter richten; de uitvoering is geschorst tot het vonnis in kracht van gewijsde is;
 * - art. 3.92 §5: haalt een voorstel over dringende en noodzakelijke werken de meerderheid niet, dan kan iedere mede-eigenaar de rechter
 *   toestemming vragen om ze op kosten van de VME uit te voeren;
 * - art. 3.87 §12: de syndicus neemt de beslissingen binnen 30 dagen op in het register en bezorgt ze aan alle stemgerechtigden.
 */
export const DECISION_KINDS: Record<string, string> = { general: "Algemeen", works: "Werken aan de gemeenschappelijke delen", statutes: "Statuten of reglement", demolition: "Volledige afbraak en heropbouw", other: "Andere" };

export function addMonths(isoDate: string, n: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
}
const addDays = (isoDate: string, n: number) => { const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export type DecisionStatus = "challengeable" | "final" | "challenged" | "annulled" | "modified" | "awaiting_court" | "court_refused";
export interface DecisionInput { decided_on: string; kind: string; adopted: number | null; unanimous: boolean; challenge_status: string | null; court_status: string | null; minutes_sent_at?: string | null }
export interface DecisionTerms {
  decided_on: string; challenge_until: string; tenant_until: string; minutes_due: string; minutes_late: boolean;
  status: DecisionStatus; status_label: string; needs_court: boolean; court_until: string | null; execution_suspended: boolean; hints: string[];
}

export function decisionTerms(i: DecisionInput, today = new Date().toISOString().slice(0, 10)): DecisionTerms {
  const decided = i.decided_on.slice(0, 10);
  const challengeUntil = addMonths(decided, 4);
  const minutesDue = addDays(decided, 30);
  const needsCourt = i.kind === "demolition" && i.adopted === 1 && !i.unanimous;
  const hints: string[] = [];
  let status: DecisionStatus; let label: string;
  if (i.challenge_status === "annulled") { status = "annulled"; label = "Vernietigd door de rechter"; }
  else if (i.challenge_status === "modified") { status = "modified"; label = "Gewijzigd door de rechter"; }
  else if (i.challenge_status === "pending") { status = "challenged"; label = "Aangevochten bij de rechter"; }
  else if (needsCourt && i.court_status === "refused") { status = "court_refused"; label = "Niet bekrachtigd door de rechter"; }
  else if (needsCourt && i.court_status !== "approved") { status = "awaiting_court"; label = i.court_status === "filed" ? "Uitvoering geschorst: zaak bij de vrederechter" : `Uitvoering geschorst: VME moet vóór ${challengeUntil} naar de vrederechter`; }
  else if (today <= challengeUntil) { status = "challengeable"; label = `Aanvechtbaar tot ${challengeUntil}`; }
  else { status = "final"; label = "Definitief (aanvechtingstermijn verstreken)"; }
  if (needsCourt) hints.push(`Volledige afbraak en heropbouw zonder eenparigheid: de VME richt zich binnen 4 maanden (vóór ${challengeUntil}) tot de vrederechter, tegen de mede-eigenaars die niet instemden; de uitvoering is geschorst tot het vonnis in kracht van gewijsde is (art. 3.92 §1 BW).`);
  if (i.kind === "works" && i.adopted === 0) hints.push("Gaat het om dringende en noodzakelijke werken, dan kan iedere mede-eigenaar de rechter toestemming vragen om ze op kosten van de VME uit te voeren (art. 3.92 §5 BW).");
  const minutesLate = !!(i.minutes_sent_at ? i.minutes_sent_at.slice(0, 10) > minutesDue : today > minutesDue);
  return { decided_on: decided, challenge_until: challengeUntil, tenant_until: challengeUntil, minutes_due: minutesDue, minutes_late: minutesLate, status, status_label: label, needs_court: needsCourt, court_until: needsCourt ? challengeUntil : null, execution_suspended: status === "awaiting_court" || status === "court_refused", hints };
}
