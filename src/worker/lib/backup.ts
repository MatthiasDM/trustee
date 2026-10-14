import type { Env } from "../env";

const TABLES: [string, string][] = [
  ["buildings", "id"], ["building_members", "building_id"], ["units", "building_id"], ["invites", "building_id"], ["folders", "building_id"], ["documents", "building_id"],
  ["posts", "building_id"], ["polls", "building_id"], ["meetings", "building_id"], ["agenda_items", "building_id"], ["mandates", "building_id"], ["audit_log", "building_id"],
  ["fiscal_years", "building_id"], ["accounts", "building_id"], ["cost_keys", "building_id"], ["journal_entries", "building_id"], ["journal_lines", "building_id"],
  ["fixed_assets", "building_id"], ["contribution_calls", "building_id"], ["budgets", "building_id"], ["bank_accounts", "building_id"], ["bank_transactions", "building_id"], ["ledger_comments", "building_id"],
];
const CHILD: [string, string, string][] = [
  ["unit_owners", "unit_id", "units"], ["comments", "post_id", "posts"], ["poll_options", "poll_id", "polls"], ["poll_votes", "poll_id", "polls"], ["meeting_rsvps", "meeting_id", "meetings"],
  ["document_comments", "document_id", "documents"], ["cost_key_units", "cost_key_id", "cost_keys"], ["contribution_call_lines", "call_id", "contribution_calls"], ["budget_lines", "budget_id", "budgets"],
];

/** Volledige export van één gebouw (alle tabellen), voor back-up en AVG-inzage. Documenten zelf blijven in R2; de metadata zit erin. */
export async function exportBuilding(env: Env, buildingId: string) {
  const out: Record<string, unknown[]> = {};
  for (const [t, col] of TABLES) out[t] = (await env.DB.prepare(`SELECT * FROM ${t} WHERE ${col} = ?`).bind(buildingId).all()).results;
  for (const [t, col, parent] of CHILD) out[t] = (await env.DB.prepare(`SELECT c.* FROM ${t} c WHERE c.${col} IN (SELECT id FROM ${parent} WHERE ${parent === "buildings" ? "id" : "building_id"} = ?)`).bind(buildingId).all()).results;
  const userIds = new Set<string>();
  for (const m of out.building_members as any[]) userIds.add(m.user_id);
  out.users = userIds.size ? (await env.DB.prepare(`SELECT id, email, name, phone, locale, created_at FROM users WHERE id IN (${[...userIds].map(() => "?").join(",")})`).bind(...userIds).all()).results : [];
  return { format: "trustee-backup", version: 1, exported_at: new Date().toISOString(), building_id: buildingId, ...out };
}

/** Dagelijkse back-up van elk gebouw naar R2 (backups/<building>/<datum>.json). */
export async function runBackups(env: Env) {
  const buildings = (await env.DB.prepare("SELECT id FROM buildings").all()).results as { id: string }[];
  const date = new Date().toISOString().slice(0, 10);
  for (const b of buildings) {
    const data = await exportBuilding(env, b.id);
    await env.DOCS.put(`backups/${b.id}/${date}.json`, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
    // bewaarbeleid: dagelijkse back-ups 60 dagen, back-ups van de 1e van de maand 36 maanden
    const list = await env.DOCS.list({ prefix: `backups/${b.id}/` });
    const keepDaily = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    const keepMonthly = new Date(Date.now() - 36 * 30.5 * 86400_000).toISOString().slice(0, 10);
    for (const o of list.objects) { const dt = o.key.split("/").pop()!.replace(".json", ""); const monthly = dt.endsWith("-01"); if ((monthly && dt < keepMonthly) || (!monthly && dt < keepDaily)) await env.DOCS.delete(o.key); }
  }
  return buildings.length;
}
