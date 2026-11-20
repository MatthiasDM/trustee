import type { Env } from "../env";
import { HttpError } from "./util";

/**
 * Back-up en herstel van één gebouw.
 *
 * Elke tabel uit `migrations/` staat ofwel in BACKUP_TABLES, ofwel in BACKUP_SPECIAL, ofwel (met reden) in BACKUP_EXCLUDED.
 * `tests/backup.test.ts` leest de migraties en faalt zodra een nieuwe tabel in geen van de drie staat, of zodra een kolom
 * die naar `users` verwijst ontbreekt in `users`. Voeg een nieuwe tabel dus hier toe in dezelfde commit als haar migratie.
 */
export const BACKUP_VERSION = 2;

type Spec = { table: string; where: string; /** kolommen die naar users(id) verwijzen */ users?: string[] };
const own = "t.building_id = ?1";
const via = (col: string, parent: string) => `t.${col} IN (SELECT id FROM ${parent} WHERE building_id = ?1)`;
const ORG = "(SELECT org_id FROM buildings WHERE id = ?1)";

export const BACKUP_TABLES: Spec[] = [
  // kantoor (enkel teruggezet als het kantoor niet meer bestaat)
  { table: "orgs", where: `t.id = ${ORG}` },
  { table: "org_members", where: `t.org_id = ${ORG}`, users: ["user_id"] },
  // gebouw, leden, kavels
  { table: "buildings", where: "t.id = ?1", users: ["liquidator_user_id"] },
  { table: "building_members", where: own, users: ["user_id"] },
  { table: "units", where: own, users: ["representative_user_id"] },
  { table: "unit_owners", where: via("unit_id", "units"), users: ["user_id"] },
  { table: "invites", where: own, users: ["invited_by"] },
  { table: "unit_transfers", where: own, users: ["buyer_user_id", "created_by"] },
  // documenten
  { table: "folders", where: own },
  { table: "documents", where: own, users: ["uploaded_by", "deleted_by"] },
  { table: "document_comments", where: via("document_id", "documents"), users: ["author_id"] },
  { table: "compliance_items", where: own },
  // communicatie
  { table: "posts", where: own, users: ["author_id", "assignee_id"] },
  { table: "comments", where: via("post_id", "posts"), users: ["author_id"] },
  { table: "post_attachments", where: via("post_id", "posts") },
  { table: "infrastructure_works", where: own, users: ["submitted_by", "objected_by"] },
  // stemmingen
  { table: "polls", where: own, users: ["created_by"] },
  { table: "poll_options", where: via("poll_id", "polls") },
  { table: "poll_votes", where: via("poll_id", "polls"), users: ["user_id"] },
  { table: "poll_documents", where: via("poll_id", "polls") },
  // algemene vergadering en organen
  { table: "meetings", where: own, users: ["created_by", "chair_user_id", "secretary_user_id", "convened_by", "cancelled_by"] },
  { table: "meeting_rsvps", where: via("meeting_id", "meetings"), users: ["user_id", "proxy_user_id"] },
  { table: "meeting_questions", where: own, users: ["author_id"] },
  { table: "minutes_receipts", where: via("meeting_id", "meetings"), users: ["user_id"] },
  { table: "registered_mail", where: own, users: ["user_id", "created_by"] },
  { table: "meeting_requests", where: own, users: ["created_by", "resolved_by"] },
  { table: "meeting_request_signatures", where: via("request_id", "meeting_requests"), users: ["user_id"] },
  { table: "agenda_items", where: own, users: ["submitted_by"] },
  { table: "mandates", where: own, users: ["user_id"] },
  // boekhouding
  { table: "fiscal_years", where: own },
  { table: "accounts", where: own },
  { table: "cost_keys", where: own },
  { table: "cost_key_units", where: via("cost_key_id", "cost_keys") },
  { table: "journal_entries", where: own, users: ["created_by"] },
  { table: "journal_lines", where: own },
  { table: "ledger_comments", where: own, users: ["author_id"] },
  { table: "fixed_assets", where: own },
  { table: "recurring_entries", where: own, users: ["created_by"] },
  { table: "contribution_calls", where: own },
  { table: "contribution_call_lines", where: via("call_id", "contribution_calls") },
  { table: "budgets", where: own },
  { table: "budget_lines", where: via("budget_id", "budgets") },
  { table: "bank_accounts", where: own },
  { table: "bank_transactions", where: own },
  { table: "suppliers", where: own },
  { table: "payment_reminders", where: own, users: ["sent_by"] },
  { table: "reminder_proposals", where: own, users: ["resolved_by"] },
  { table: "commissioner_reports", where: own, users: ["author_id"] },
  // logboek
  { table: "email_log", where: own, users: ["user_id"] },
  { table: "audit_log", where: own, users: ["user_id"] },
];

/** Apart behandeld: enkel de gebruikers waarnaar het gebouw verwijst (zonder wachtwoord of 2FA-geheim) en hun aanvaardingen. */
export const BACKUP_SPECIAL = ["users", "consents"];

/** Bewust niet in de back-up. */
export const BACKUP_EXCLUDED: Record<string, string> = {
  sessions: "aanmeldsessies: na herstel meldt iedereen opnieuw aan",
  password_resets: "eenmalige tokens",
  push_subscriptions: "toestelgebonden; de gebruiker schakelt push opnieuw in",
  notifications: "persoonlijke inbox; de rechtsfeiten (oproeping, bezorging notulen) staan in audit_log en minutes_receipts",
  demo_starts: "teller van de publieke demo",
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function byIds(db: D1Database, sql: string, ids: string[]) {
  const out: any[] = [];
  for (const part of chunk(ids, 90)) out.push(...(await db.prepare(`${sql} (${part.map(() => "?").join(",")})`).bind(...part).all()).results); // D1: max. 100 parameters per query
  return out;
}

/** Volledige export van één gebouw (alle tabellen), voor back-up, archief en AVG-inzage. Documenten zelf blijven in R2; de metadata (met r2_key) zit erin. */
export async function exportBuilding(env: Env, buildingId: string) {
  const out: Record<string, any[]> = {};
  const userIds = new Set<string>();
  for (const s of BACKUP_TABLES) {
    const rows = (await env.DB.prepare(`SELECT t.* FROM ${s.table} t WHERE ${s.where}`).bind(buildingId).all()).results as any[];
    out[s.table] = rows;
    for (const col of s.users ?? []) for (const r of rows) if (r[col]) userIds.add(r[col]);
  }
  const ids = [...userIds].sort();
  out.users = await byIds(env.DB, "SELECT id, email, name, phone, locale, created_at FROM users WHERE id IN", ids);
  out.consents = await byIds(env.DB, "SELECT * FROM consents WHERE user_id IN", ids);
  return { format: "trustee-backup", version: BACKUP_VERSION, exported_at: new Date().toISOString(), building_id: buildingId, ...out };
}

/**
 * Zet één gebouw terug uit een back-up, in één transactie. Enkel als het gebouw niet (meer) bestaat: herstellen overschrijft nooit.
 * - Gebruikers die al bestaan blijven ongemoeid; ontbrekende worden aangemaakt zonder wachtwoord (zij kiezen er een via "wachtwoord vergeten").
 * - Het kantoor en zijn medewerkers komen enkel terug als het kantoor niet meer bestaat; anders zouden verwijderde medewerkers opnieuw toegang krijgen.
 * - Documenten: enkel de metadata. De bestanden moeten nog onder hun r2_key in de bucket staan.
 */
export async function restoreBuilding(db: D1Database, data: any) {
  if (data?.format !== "trustee-backup" || !Array.isArray(data.buildings) || data.buildings.length !== 1) throw new HttpError(400, "Geen geldige Trustee-back-up van één gebouw");
  if (data.version !== BACKUP_VERSION) throw new HttpError(400, `Deze back-up heeft formaatversie ${data.version}; enkel versie ${BACKUP_VERSION} kan hersteld worden (oudere back-ups zijn onvolledig)`);
  const b = data.buildings[0];
  const exists = async (table: string, id: string) => !!(await db.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ?`).bind(id).first());
  if (await exists("buildings", b.id)) throw new HttpError(409, "Dit gebouw bestaat al. Herstellen kan enkel als het gebouw niet (meer) bestaat.");
  if (b.parent_building_id && !(await exists("buildings", b.parent_building_id))) throw new HttpError(409, "Dit is een deelvereniging: herstel eerst de hoofdvereniging");

  const stmts: D1PreparedStatement[] = [db.prepare("PRAGMA defer_foreign_keys = on")]; // kringverwijzingen (gebouw ↔ agendapunt ↔ document) pas bij de commit toetsen
  const rows: Record<string, number> = {};
  const insert = (table: string, row: Record<string, unknown>, orIgnore = false) => {
    const cols = Object.keys(row);
    if (!cols.length || cols.some((c) => !IDENT.test(c))) throw new HttpError(400, `Ongeldige kolomnaam in ${table}`);
    stmts.push(db.prepare(`INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => row[c] ?? null)));
    rows[table] = (rows[table] ?? 0) + 1;
  };

  let newUsers = 0;
  for (const u of (data.users ?? []) as any[]) {
    const found = (await db.prepare("SELECT id FROM users WHERE id = ?1 OR email = ?2").bind(u.id, u.email).all<{ id: string }>()).results;
    if (found.some((f) => f.id === u.id)) continue;
    if (found.length) throw new HttpError(409, `Het e-mailadres ${u.email} hoort hier bij een ander account dan in de back-up`);
    insert("users", { id: u.id, email: u.email, name: u.name, phone: u.phone ?? null, locale: u.locale ?? "nl", created_at: u.created_at, password_hash: "restored" });
    newUsers++;
  }
  const orgExists = await exists("orgs", b.org_id);
  for (const s of BACKUP_TABLES) {
    if (orgExists && (s.table === "orgs" || s.table === "org_members")) continue;
    for (const r of (data[s.table] ?? []) as any[]) insert(s.table, r);
  }
  for (const r of (data.consents ?? []) as any[]) insert("consents", r, true);

  try { await db.batch(stmts); } catch (e) {
    if (/FOREIGN KEY/i.test(String((e as Error)?.message ?? e))) throw new HttpError(409, "De back-up verwijst naar gegevens die hier niet bestaan (bv. kavels van de hoofdvereniging). Er is niets teruggezet.");
    throw e;
  }
  return { building_id: b.id as string, name: b.name as string, rows, new_users: newUsers, org_restored: !orgExists };
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
