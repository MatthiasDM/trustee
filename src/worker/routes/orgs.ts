import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { HttpError, plusMs, randomToken, uid } from "../lib/util";
import { layout, sendEmail } from "../lib/email";
import { escapeHtml } from "../lib/notify";
import { overdueUnits } from "../lib/reports";

const orgs = new Hono<AppEnv>();
orgs.use("*", requireAuth);

async function requireOrg(c: Context<AppEnv>, orgId: string, roles?: string[]) {
  const user = c.get("user");
  const m = await c.env.DB.prepare("SELECT om.role, o.* FROM org_members om JOIN orgs o ON o.id = om.org_id WHERE om.org_id = ? AND om.user_id = ?").bind(orgId, user.id).first<any>();
  if (!m && !user.is_superadmin) throw new HttpError(403, "Geen toegang tot deze organisatie");
  if (roles && m && !roles.includes(m.role)) throw new HttpError(403, "Onvoldoende rechten");
  return m ?? { role: "owner" };
}

/** Kantoorportaal: alle gebouwen van de organisatie met de cijfers die een syndicus dagelijks nodig heeft. */
orgs.get("/:orgId/overview", async (c) => {
  const org = await requireOrg(c, c.req.param("orgId"));
  const today = new Date().toISOString().slice(0, 10); const soon = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const buildings = (await c.env.DB.prepare(`SELECT b.id, b.name, b.address, b.city, b.total_shares,
      (SELECT COUNT(*) FROM building_members bm WHERE bm.building_id = b.id) AS members,
      (SELECT COUNT(*) FROM units u WHERE u.building_id = b.id) AS units,
      (SELECT COUNT(*) FROM posts p WHERE p.building_id = b.id AND p.type = 'incident' AND p.status IN ('open','in_progress')) AS open_incidents,
      (SELECT COUNT(*) FROM posts p WHERE p.building_id = b.id AND p.type = 'question' AND p.status = 'open') AS open_questions,
      (SELECT COUNT(*) FROM posts p WHERE p.building_id = b.id AND p.priority = 'urgent' AND p.status IN ('open','in_progress')) AS urgent,
      (SELECT COUNT(*) FROM polls p WHERE p.building_id = b.id AND p.status = 'open') AS open_polls,
      (SELECT COUNT(*) FROM agenda_items a WHERE a.building_id = b.id AND a.status = 'proposed') AS proposed_items,
      (SELECT MIN(m.starts_at) FROM meetings m WHERE m.building_id = b.id AND m.type IN ('av','bav') AND m.starts_at >= ?1) AS next_av,
      (SELECT COUNT(*) FROM meetings m WHERE m.building_id = b.id AND m.starts_at < ?1 AND m.type IN ('av','bav') AND m.minutes_status != 'final' AND m.starts_at > date(?1, '-60 days')) AS minutes_pending,
      (SELECT COUNT(*) FROM mandates md WHERE md.building_id = b.id AND md.end_date BETWEEN ?1 AND ?2) AS mandates_expiring,
      (SELECT COUNT(*) FROM mandates md WHERE md.building_id = b.id AND md.organ = 'commissaris' AND md.start_date <= ?1 AND md.end_date >= ?1) AS has_commissaris,
      (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.building_id = b.id AND bt.status = 'unmatched') AS unmatched_bank,
      (SELECT COALESCE(SUM(jl.debit - jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = b.id AND je.status = 'posted' AND a.class = 5 AND a.fund = 'working') AS working_cash,
      (SELECT COALESCE(SUM(jl.debit - jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.building_id = b.id AND je.status = 'posted' AND a.class = 5 AND a.fund = 'reserve') AS reserve_cash,
      (SELECT COUNT(*) FROM fiscal_years fy WHERE fy.building_id = b.id AND fy.status = 'open' AND fy.end_date < ?1) AS years_to_close,
      (SELECT COUNT(*) FROM invites i WHERE i.building_id = b.id AND i.accepted_at IS NULL AND i.expires_at > ?1) AS open_invites
     FROM buildings b WHERE b.org_id = ?3 ORDER BY b.name`).bind(today, soon, c.req.param("orgId")).all()).results as any[];
  for (const b of buildings) { const od = await overdueUnits(c.env, b.id); b.overdue_units = od.filter((u) => u.days_overdue > 0).length; b.overdue_amount = Math.round(od.reduce((s, u) => s + u.outstanding, 0) * 100) / 100; }
  const members = (await c.env.DB.prepare("SELECT om.role, u.id, u.name, u.email FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? ORDER BY u.name").bind(c.req.param("orgId")).all()).results;
  const totals = { buildings: buildings.length, units: buildings.reduce((s, b) => s + b.units, 0), members: buildings.reduce((s, b) => s + b.members, 0), open_incidents: buildings.reduce((s, b) => s + b.open_incidents, 0), unmatched_bank: buildings.reduce((s, b) => s + b.unmatched_bank, 0), overdue_amount: Math.round(buildings.reduce((s, b) => s + b.overdue_amount, 0) * 100) / 100, working_cash: Math.round(buildings.reduce((s, b) => s + b.working_cash, 0) * 100) / 100, reserve_cash: Math.round(buildings.reduce((s, b) => s + b.reserve_cash, 0) * 100) / 100 };
  // actiepunten over alle gebouwen
  const actions: { building_id: string; building: string; kind: string; text: string; n: number; amount?: number; link: string; severity: "high" | "medium" | "low" }[] = [];
  for (const b of buildings) {
    if (b.urgent) actions.push({ building_id: b.id, building: b.name, kind: "incident", n: b.urgent, text: `${b.urgent} dringende melding(en)`, link: `/b/${b.id}/posts?type=incident`, severity: "high" });
    if (b.overdue_units) actions.push({ building_id: b.id, building: b.name, kind: "overdue", n: b.overdue_units, amount: b.overdue_amount, text: `${b.overdue_units} kavel(s) met vervallen voorschotten (€ ${b.overdue_amount.toFixed(2)})`, link: `/b/${b.id}/ledger?tab=followup`, severity: "high" });
    if (b.minutes_pending) actions.push({ building_id: b.id, building: b.name, kind: "minutes", n: b.minutes_pending, text: "Notulen van een recente AV nog niet definitief (30 dagen)", link: `/b/${b.id}/meetings`, severity: "high" });
    if (b.years_to_close) actions.push({ building_id: b.id, building: b.name, kind: "close", n: b.years_to_close, text: "Boekjaar verstreken, nog niet afgesloten", link: `/b/${b.id}/ledger?tab=settings`, severity: "medium" });
    if (!b.has_commissaris) actions.push({ building_id: b.id, building: b.name, kind: "commissaris", n: 1, text: "Geen commissaris van de rekeningen voor dit jaar", link: `/b/${b.id}/members?tab=mandates`, severity: "medium" });
    if (b.mandates_expiring) actions.push({ building_id: b.id, building: b.name, kind: "mandate", n: b.mandates_expiring, text: `${b.mandates_expiring} mandaat/mandaten lopen binnen 90 dagen af`, link: `/b/${b.id}/members?tab=mandates`, severity: "medium" });
    if (b.unmatched_bank) actions.push({ building_id: b.id, building: b.name, kind: "bank", n: b.unmatched_bank, text: `${b.unmatched_bank} bankverrichting(en) te verwerken`, link: `/b/${b.id}/ledger?tab=bank`, severity: "low" });
    if (b.proposed_items) actions.push({ building_id: b.id, building: b.name, kind: "agenda", n: b.proposed_items, text: `${b.proposed_items} agendapunt(en) voorgesteld door eigenaars`, link: `/b/${b.id}/meetings`, severity: "low" });
    if (b.open_questions) actions.push({ building_id: b.id, building: b.name, kind: "question", n: b.open_questions, text: `${b.open_questions} onbeantwoorde vraag/vragen`, link: `/b/${b.id}/posts?type=question`, severity: "low" });
  }
  const order = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => order[a.severity] - order[b.severity]);
  return c.json({ org: { id: org.id, name: org.name, plan: org.plan, slug: org.slug, role: org.role }, buildings, totals, actions, members });
});

orgs.patch("/:orgId", async (c) => {
  await requireOrg(c, c.req.param("orgId"), ["owner", "admin"]);
  const { name } = z.object({ name: z.string().min(2).max(120) }).parse(await c.req.json());
  await c.env.DB.prepare("UPDATE orgs SET name = ? WHERE id = ?").bind(name, c.req.param("orgId")).run();
  return c.json({ ok: true });
});

/** Medewerker van het kantoor toevoegen: bestaand account wordt direct lid; anders uitnodiging per e-mail (wordt syndicus-lid van alle gebouwen van het kantoor na registratie). */
orgs.post("/:orgId/members", async (c) => {
  const org = await requireOrg(c, c.req.param("orgId"), ["owner", "admin"]);
  const { email, role } = z.object({ email: z.string().email(), role: z.enum(["admin", "staff"]).default("staff") }).parse(await c.req.json());
  const u = await c.env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email.toLowerCase()).first<any>();
  if (u) { await c.env.DB.prepare("INSERT OR REPLACE INTO org_members (org_id, user_id, role) VALUES (?,?,?)").bind(org.id, u.id, role).run(); return c.json({ ok: true, added: u.name }); }
  const url = `${c.env.APP_URL}/register?org=${org.id}&email=${encodeURIComponent(email)}`;
  await sendEmail(c.env, email, `Uitnodiging kantoor ${org.name}`, layout(c.env, `Welkom bij ${escapeHtml(org.name)}`, `<p>Je bent uitgenodigd als medewerker van het syndicuskantoor <strong>${escapeHtml(org.name)}</strong> op Trustee. Maak een account aan; vraag daarna aan de beheerder om je toe te voegen.</p>`, { label: "Account aanmaken", url }), url);
  return c.json({ ok: true, invited: true });
});
orgs.delete("/:orgId/members/:userId", async (c) => {
  const org = await requireOrg(c, c.req.param("orgId"), ["owner", "admin"]);
  if (c.req.param("userId") === c.get("user").id) throw new HttpError(400, "Je kan jezelf niet verwijderen");
  await c.env.DB.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ? AND role != 'owner'").bind(org.id, c.req.param("userId")).run();
  return c.json({ ok: true });
});

export default orgs;
