import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, patchOf, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { generateAnnualReport, generateOwnerStatements, overdueUnits, renderCommissionerReport, storeDocument } from "../lib/reports";
import { Pdf, dateNl, money } from "../lib/pdf";
import { postEntry } from "../lib/ledger";
import { cashbook, countedUnits, ledgerMode } from "../lib/cashbook";
import { generateTransferDossier } from "../lib/transfer";

const reports = new Hono<AppEnv>();
reports.use("*", requireAuth);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- Jaarrekening en afrekeningen ----------
reports.post("/:buildingId/ledger/fiscal-years/:fyId/report", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const fy = await c.env.DB.prepare("SELECT status FROM fiscal_years WHERE id = ? AND building_id = ?").bind(c.req.param("fyId"), b.id).first<any>();
  if (!fy) throw new HttpError(404, "Boekjaar niet gevonden");
  const docId = await generateAnnualReport(c.env, b.id, c.get("user").id, c.req.param("fyId"), fy.status !== "closed");
  await audit(c.env, b.id, c.get("user").id, "ledger.report", "fiscal_year", c.req.param("fyId"));
  return c.json({ documentId: docId, provisional: fy.status !== "closed" }, 201);
});

reports.post("/:buildingId/ledger/statements/:fyId/send", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const fy = await c.env.DB.prepare("SELECT label FROM fiscal_years WHERE id = ? AND building_id = ?").bind(c.req.param("fyId"), b.id).first<any>();
  if (!fy) throw new HttpError(404, "Boekjaar niet gevonden");
  const { notify } = z.object({ notify: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})));
  const made = await generateOwnerStatements(c.env, b.id, user.id, c.req.param("fyId"));
  if (notify) for (const m of made) await notifyBuilding(c.env, { buildingId: b.id, type: "statement", title: `Afrekening boekjaar ${fy.label} voor kavel ${m.label}`, body: m.outstanding > 0 ? `Nog te betalen: € ${m.outstanding.toFixed(2)}. De afrekening staat bij Documenten.` : "Uw afrekening staat bij Documenten.", link: `/b/${b.id}/documents`, userIds: m.owner_ids });
  await audit(c.env, b.id, user.id, "ledger.statements_sent", "fiscal_year", c.req.param("fyId"), { count: made.length });
  return c.json({ sent: made.length, statements: made }, 201);
});

// ---------- Verslag commissaris ----------
const crSchema = z.object({ fiscal_year_id: z.string(), period_from: ymd, period_to: ymd, scope: z.string().max(5000).nullable().optional(), findings: z.string().max(20000).nullable().optional(), conclusion: z.enum(["approve", "approve_with_remarks", "reject"]).default("approve"), recommendation: z.string().max(5000).nullable().optional() });

reports.get("/:buildingId/ledger/commissioner-reports", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = (await c.env.DB.prepare("SELECT cr.*, u.name AS author_name, fy.label AS fy_label, d.name AS document_name FROM commissioner_reports cr JOIN users u ON u.id = cr.author_id JOIN fiscal_years fy ON fy.id = cr.fiscal_year_id LEFT JOIN documents d ON d.id = cr.document_id WHERE cr.building_id = ? ORDER BY cr.created_at DESC").bind(b.id).all()).results as any[];
  // ontwerpen zijn enkel voor de organen; definitieve verslagen voor iedereen
  return c.json(isBoard(b.role) ? rows : rows.filter((r) => r.status === "final"));
});
reports.post("/:buildingId/ledger/commissioner-reports", requireBuilding("commissaris", "syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = crSchema.parse(await c.req.json());
  const id = uid();
  await c.env.DB.prepare("INSERT INTO commissioner_reports (id, building_id, fiscal_year_id, author_id, period_from, period_to, scope, findings, conclusion, recommendation) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, b.id, body.fiscal_year_id, user.id, body.period_from, body.period_to, body.scope ?? null, body.findings ?? null, body.conclusion, body.recommendation ?? null).run();
  return c.json({ id }, 201);
});
reports.patch("/:buildingId/ledger/commissioner-reports/:id", requireBuilding("commissaris", "syndicus"), async (c) => {
  const b = c.get("building");
  const r = await c.env.DB.prepare("SELECT * FROM commissioner_reports WHERE id = ? AND building_id = ?").bind(c.req.param("id"), b.id).first<any>();
  if (!r) throw new HttpError(404, "Verslag niet gevonden");
  if (r.status === "final") throw new HttpError(400, "Het verslag is definitief");
  if (r.author_id !== c.get("user").id && b.role !== "syndicus") throw new HttpError(403, "Enkel de auteur kan dit verslag bewerken");
  const body = patchOf(crSchema.partial(), await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE commissioner_reports SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, v]) => v), r.id).run();
  return c.json({ ok: true });
});
/** Definitief: PDF in Documenten (categorie controleverslag), agendapunt "verslag commissaris en kwijting" voorgesteld, melding aan alle leden. */
reports.post("/:buildingId/ledger/commissioner-reports/:id/finalize", requireBuilding("commissaris", "syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const r = await c.env.DB.prepare("SELECT cr.*, u.name AS author_name, fy.label AS fy_label FROM commissioner_reports cr JOIN users u ON u.id = cr.author_id JOIN fiscal_years fy ON fy.id = cr.fiscal_year_id WHERE cr.id = ? AND cr.building_id = ?").bind(c.req.param("id"), b.id).first<any>();
  if (!r) throw new HttpError(404, "Verslag niet gevonden");
  if (r.status === "final") throw new HttpError(400, "Al definitief");
  if (r.author_id !== user.id) throw new HttpError(403, "Enkel de commissaris die het verslag opstelde kan het definitief maken");
  const bytes = await renderCommissionerReport(c.env, b.id, r, r.author_name, r.fy_label);
  const docId = await storeDocument(c.env, b.id, user.id, { name: `Verslag commissaris van de rekeningen ${r.fy_label}.pdf`, bytes, mime: "application/pdf", category: "controleverslag", description: `Controleverslag boekjaar ${r.fy_label} door ${r.author_name}.`, folderMatch: /boekhouding/i });
  const agendaId = uid();
  const concl: Record<string, string> = { approve: "goedkeuring van de rekeningen en kwijting aan de syndicus", approve_with_remarks: "goedkeuring van de rekeningen en kwijting, met opmerkingen", reject: "uitstel van de kwijting" };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO agenda_items (id, building_id, submitted_by, title, description, required_majority, status) VALUES (?,?,?,?,?,'simple','proposed')").bind(agendaId, b.id, user.id, `Verslag commissaris van de rekeningen ${r.fy_label}: ${concl[r.conclusion]}`, `Zie het verslag in Documenten. Advies: ${concl[r.conclusion]}.`),
    c.env.DB.prepare("UPDATE commissioner_reports SET status = 'final', document_id = ?, agenda_item_id = ?, finalized_at = ? WHERE id = ?").bind(docId, agendaId, new Date().toISOString(), r.id),
  ]);
  await audit(c.env, b.id, user.id, "commissioner.report", "fiscal_year", r.fiscal_year_id, { conclusion: r.conclusion });
  await notifyBuilding(c.env, { buildingId: b.id, type: "controleverslag", title: `Verslag commissaris ${r.fy_label} beschikbaar`, body: `Advies: ${concl[r.conclusion]}. Het verslag staat bij Documenten en is als agendapunt voorgesteld voor de AV.`, link: `/b/${b.id}/documents`, excludeUserId: user.id, roles: ["syndicus", "raad", "eigenaar", "commissaris"] });
  return c.json({ ok: true, documentId: docId, agendaItemId: agendaId });
});

// ---------- Betalingsopvolging ----------
reports.get("/:buildingId/ledger/overdue", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const b = c.get("building");
  const units = await overdueUnits(c.env, b.id);
  const cfg = await c.env.DB.prepare("SELECT reminder_auto, reminder_days_1, reminder_days_2, reminder_fee_2 FROM buildings WHERE id = ?").bind(b.id).first();
  const history = (await c.env.DB.prepare("SELECT pr.*, un.label, u.name AS sent_by_name FROM payment_reminders pr JOIN units un ON un.id = pr.unit_id LEFT JOIN users u ON u.id = pr.sent_by WHERE pr.building_id = ? ORDER BY pr.sent_at DESC LIMIT 100").bind(b.id).all()).results;
  return c.json({ units, config: cfg, history });
});

export async function sendReminder(env: AppEnv["Bindings"], buildingId: string, userId: string | null, unitId: string, level: number, fee: number): Promise<string> {
  const b = await env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(buildingId).first<any>();
  const u = (await overdueUnits(env, buildingId)).find((x) => x.unit_id === unitId);
  if (!u) throw new HttpError(400, "Deze kavel heeft geen openstaand saldo");
  const owners = (await env.DB.prepare("SELECT uo.user_id, us.name FROM unit_owners uo JOIN users us ON us.id = uo.user_id WHERE uo.unit_id = ?").bind(unitId).all()).results as any[];
  const bank = await env.DB.prepare("SELECT iban FROM bank_accounts WHERE building_id = ? AND fund = 'working' LIMIT 1").bind(buildingId).first<any>();
  const line = await env.DB.prepare("SELECT ccl.ogm FROM contribution_call_lines ccl JOIN contribution_calls cc ON cc.id = ccl.call_id WHERE ccl.unit_id = ? AND cc.building_id = ? ORDER BY cc.date DESC LIMIT 1").bind(unitId, buildingId).first<any>();
  let entryId: string | null = null;
  if (fee > 0) entryId = await postEntry(env, buildingId, userId, { date: new Date().toISOString().slice(0, 10), description: `Aanmaningskosten kavel ${u.label}`, source: "manual", lines: [{ account_code: "4101", debit: fee, unit_id: unitId }, { account_code: "740", credit: fee, memo: "aanmaningskosten" }] });
  const total = Math.round((u.outstanding + fee) * 100) / 100;
  const titles = ["", "Betalingsherinnering", "Aanmaning", "Ingebrekestelling"];
  const pdf = await Pdf.create(`${b.name} - ${titles[level]} kavel ${u.label}`);
  pdf.title(`${titles[level]} - kavel ${u.label}`);
  pdf.text(`Vereniging van mede-eigenaars ${b.name}, ${b.address}. ${dateNl(new Date().toISOString())}.`);
  pdf.text(`Geachte ${u.owners ?? "mede-eigenaar"},`);
  pdf.text(level === 1 ? `Volgens onze boekhouding staat voor kavel ${u.label} nog ${money(u.outstanding)} aan opgeroepen voorschotten open; de vervaldag is ${u.days_overdue} dagen verstreken. Mogelijk kruist deze herinnering uw betaling; in dat geval kunt u ze als onbestaande beschouwen.` : level === 2 ? `Ondanks onze herinnering staat voor kavel ${u.label} nog ${money(u.outstanding)} open${fee > 0 ? `, vermeerderd met ${money(fee)} aanmaningskosten volgens het reglement van interne orde` : ""}. Wij verzoeken u dit bedrag binnen 15 dagen te betalen.` : `Dit is een ingebrekestelling. Voor kavel ${u.label} staat ${money(u.outstanding)} open${fee > 0 ? ` plus ${money(fee)} kosten` : ""}. Zonder betaling binnen 15 dagen zal de syndicus, in uitvoering van zijn wettelijke opdracht (art. 3.89 BW), de invordering in rechte laten starten; de kosten daarvan vallen ten laste van de in gebreke blijvende mede-eigenaar.`);
  pdf.text(`Te betalen: ${money(total)} op ${bank?.iban ?? "de rekening van de VME"}${line ? `, met gestructureerde mededeling ${line.ogm}` : ""}.`, 10.5, { bold: true });
  pdf.text("Met vriendelijke groeten,\nDe syndicus");
  const docId = await storeDocument(env, buildingId, userId, { name: `${titles[level]} kavel ${u.label} ${new Date().toISOString().slice(0, 10)}.pdf`, bytes: await pdf.bytes(), mime: "application/pdf", category: "boekhouding", description: `${titles[level]} voor ${money(total)}.`, folderMatch: /boekhouding/i, unitId, visibility: "owners_only" });
  const id = uid();
  await env.DB.prepare("INSERT INTO payment_reminders (id, building_id, unit_id, level, outstanding, fee, entry_id, document_id, sent_by) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, buildingId, unitId, level, u.outstanding, fee, entryId, docId, userId).run();
  await notifyBuilding(env, { buildingId, type: "reminder", title: `${titles[level]}: € ${total.toFixed(2)} openstaand voor kavel ${u.label}`, body: `Gelieve te betalen op ${bank?.iban ?? "de rekening van de VME"}${line ? ` met mededeling ${line.ogm}` : ""}. De brief staat bij Documenten.`, link: `/b/${buildingId}/documents`, userIds: owners.map((o) => o.user_id) });
  await audit(env, buildingId, userId, `reminder.${level}`, "unit", unitId, { outstanding: u.outstanding, fee });
  return id;
}

reports.post("/:buildingId/ledger/reminders", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building");
  const { unit_id, level, fee } = z.object({ unit_id: z.string(), level: z.number().int().min(1).max(3), fee: z.number().min(0).default(0) }).parse(await c.req.json());
  const id = await sendReminder(c.env, b.id, c.get("user").id, unit_id, level, fee);
  return c.json({ id }, 201);
});

/** Automatische opvolging (cron): herinnering na X dagen, aanmaning na Y dagen, enkel voor gebouwen die dit aanzetten. */
export async function autoReminders(env: AppEnv["Bindings"]) {
  const buildings = (await env.DB.prepare("SELECT id, reminder_days_1, reminder_days_2, reminder_fee_2 FROM buildings WHERE reminder_auto = 1").all()).results as any[];
  let sent = 0;
  for (const b of buildings) {
    for (const u of await overdueUnits(env, b.id)) {
      if (!u.oldest_due) continue;
      const lvl = u.last_level ?? 0;
      const sinceLast = u.last_sent ? (Date.now() - new Date(u.last_sent).getTime()) / 86400_000 : 999;
      if (lvl === 0 && u.days_overdue >= b.reminder_days_1) { await sendReminder(env, b.id, null, u.unit_id, 1, 0); sent++; }
      else if (lvl === 1 && u.days_overdue >= b.reminder_days_2 && sinceLast >= 7) { await sendReminder(env, b.id, null, u.unit_id, 2, b.reminder_fee_2); sent++; }
    }
  }
  return sent;
}

// ---------- Vereenvoudigde boekhouding (kasboek) ----------
reports.get("/:buildingId/ledger/mode", requireBuilding(), async (c) => {
  const b = c.get("building");
  const row = await c.env.DB.prepare("SELECT ledger_mode FROM buildings WHERE id = ?").bind(b.id).first<any>();
  const n = await countedUnits(c.env, b.id);
  return c.json({ setting: row?.ledger_mode ?? "auto", effective: await ledgerMode(c.env, b.id), counted_units: n, double_required: n >= 20 });
});
reports.get("/:buildingId/ledger/cashbook/:fyId", requireBuilding(), async (c) => c.json(await cashbook(c.env, c.get("building").id, c.req.param("fyId"))));

// ---------- Overdrachtsdossier (art. 3.94 §1) ----------
reports.post("/:buildingId/ledger/units/:unitId/transfer-dossier", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isBoard(b.role)) {
    const own = await c.env.DB.prepare("SELECT 1 FROM unit_owners WHERE unit_id = ? AND user_id = ?").bind(c.req.param("unitId"), user.id).first();
    if (!own) throw new HttpError(403, "Je kan enkel een dossier voor je eigen kavel aanvragen");
  }
  const docId = await generateTransferDossier(c.env, b.id, user.id, c.req.param("unitId"));
  await audit(c.env, b.id, user.id, "transfer.dossier", "unit", c.req.param("unitId"));
  if (!isBoard(b.role)) await notifyBuilding(c.env, { buildingId: b.id, type: "transfer", title: `Overdrachtsdossier aangevraagd door ${user.name}`, body: "Een mede-eigenaar bereidt de verkoop van zijn kavel voor; het dossier (art. 3.94) staat bij Documenten.", link: `/b/${b.id}/documents`, roles: ["syndicus"], email: false });
  return c.json({ documentId: docId }, 201);
});

export default reports;
