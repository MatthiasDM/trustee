import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, plusMs, randomToken, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { ogm, postEntry, round2 } from "../lib/ledger";
import { settlementPreview, type SettlementPreview } from "../lib/settlement";
import { syncChildUnits } from "../lib/subassoc";
import { Pdf, dateNl, money, pdfOpts } from "../lib/pdf";
import { storeDocument } from "../lib/reports";

/** Overdracht van een kavel: afrekening werkkapitaal (art. 3.94 §5), achterstallen voor de notaris (art. 3.95), eigenaarswissel. */
export const transfers = new Hono<AppEnv>();
transfers.use("*", requireAuth);

transfers.post("/:buildingId/units/:unitId/transfer/preview", requireBuilding("syndicus"), async (c) => {
  const { transfer_date } = z.object({ transfer_date: z.string() }).parse(await c.req.json());
  return c.json(await settlementPreview(c.env, c.get("building").id, c.req.param("unitId"), transfer_date));
});

transfers.get("/:buildingId/transfers", requireBuilding("syndicus", "raad", "commissaris"), async (c) => {
  const rows = (await c.env.DB.prepare("SELECT t.*, un.label FROM unit_transfers t JOIN units un ON un.id = t.unit_id WHERE t.building_id = ? ORDER BY t.transfer_date DESC").bind(c.get("building").id).all()).results;
  return c.json(rows);
});

/** Boekt het financiële deel van een overdracht in één VME (hoofd- of deelvereniging): achterstallen naar de verkoper, werkkapitaal via de koper terug naar de verkoper. */
async function bookSettlement(env: AppEnv["Bindings"], userId: string, buildingId: string, unitId: string, p: SettlementPreview, refund: number, buyerLabel: string, body: { transfer_date: string; notary?: string | null; due_date?: string | null }) {
  const c = { env }; const b = { id: buildingId }; const user = { id: userId };
  const sellerNames = p.sellers.map((s) => s.name).join(", ");
  const entryIds: string[] = [];
  // 1. Achterstallen van de verkoper loskoppelen van de kavel: vordering op de verkoper (416), af te houden door de notaris (art. 3.95)
  const arrearsLines = [
    ...(p.arrears_working > 0 ? [{ account_code: "4101", credit: p.arrears_working, unit_id: unitId, memo: `achterstal werkkapitaal ${sellerNames}` }] : []),
    ...(p.arrears_reserve > 0 ? [{ account_code: "4100", credit: p.arrears_reserve, unit_id: unitId, memo: `achterstal reservekapitaal ${sellerNames}` }] : []),
  ];
  if (arrearsLines.length) entryIds.push(await postEntry(c.env, b.id, user.id, { date: body.transfer_date, description: `Overdracht kavel ${p.unit.label}: achterstallen verkoper ${sellerNames} (af te houden door de notaris, art. 3.95 BW)`, source: "manual", counterparty: sellerNames, lines: [{ account_code: "416", debit: p.arrears_total, memo: `te vorderen van ${sellerNames}${body.notary ? ` via notaris ${body.notary}` : ""}` }, ...arrearsLines] }));
  // 2. Werkkapitaal: terug te betalen aan de verkoper (schuld 4890), opgevraagd bij de koper (vordering 4101 op de kavel)
  let callId: string | null = null; let callOgm: string | null = null;
  if (refund > 0) {
    const fyId = p.fiscal_year.id;
    const entry = await postEntry(c.env, b.id, user.id, { date: body.transfer_date, description: `Werkkapitaal bij overdracht kavel ${p.unit.label}: terug aan ${sellerNames}, opgevraagd bij ${buyerLabel} (art. 3.94 §5 BW)`, source: "call", counterparty: sellerNames, lines: [{ account_code: "4101", debit: refund, unit_id: unitId, memo: `koper ${buyerLabel}` }, { account_code: "4890", credit: refund, memo: `terug te betalen aan ${sellerNames}` }] });
    entryIds.push(entry);
    callId = uid();
    const seq = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM contribution_calls WHERE building_id = ?").bind(b.id).first<{ n: number }>();
    callOgm = ogm(`${String((seq!.n + 1) % 1000).padStart(3, "0")}${String(1).padStart(4, "0")}1${String(b.id.charCodeAt(0) % 100).padStart(2, "0")}`);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO contribution_calls (id, building_id, fiscal_year_id, fund, date, due_date, description, total, cost_key_id, entry_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(callId, b.id, fyId, "working", body.transfer_date, body.due_date ?? null, `Werkkapitaal bij overdracht kavel ${p.unit.label}`, refund, null, entry),
      c.env.DB.prepare("INSERT INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES (?,?,?,?,?)").bind(uid(), callId, unitId, refund, callOgm),
    ]);
  }
  return { entryIds, callId, callOgm, sellerNames };
}

transfers.post("/:buildingId/units/:unitId/transfer", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({
    transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    act_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notary: z.string().max(200).nullable().optional(),
    buyer_user_id: z.string().nullable().optional(),
    buyer_email: z.string().email().nullable().optional(),
    buyer_name: z.string().max(120).nullable().optional(),
    working_refund: z.number().min(0).optional(),        // de syndicus kan het voorstel aanpassen (art. 3.94 §5: hij stelt de afrekening op)
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    remove_sellers: z.boolean().default(true),
  }).parse(await c.req.json());
  if (!body.buyer_user_id && !body.buyer_email) throw new HttpError(400, "Kies de koper (bestaand lid) of geef zijn e-mailadres voor een uitnodiging");
  const unitId = c.req.param("unitId");
  const mirror = await c.env.DB.prepare("SELECT parent_unit_id FROM units WHERE id = ? AND building_id = ?").bind(unitId, b.id).first<any>();
  if (mirror?.parent_unit_id) throw new HttpError(400, "Een verkoop wordt afgerekend in de hoofdvereniging; de afrekening van deze deelvereniging gebeurt daar automatisch mee");
  const p = await settlementPreview(c.env, b.id, unitId, body.transfer_date);
  const refund = round2(body.working_refund ?? p.working_refund);
  let buyer: { id: string; name: string; email: string } | null = null;
  if (body.buyer_user_id) {
    buyer = await c.env.DB.prepare("SELECT u.id, u.name, u.email FROM users u JOIN building_members bm ON bm.user_id = u.id AND bm.building_id = ? WHERE u.id = ?").bind(b.id, body.buyer_user_id).first<any>();
    if (!buyer) throw new HttpError(400, "De koper is geen lid van dit gebouw; nodig hem uit via zijn e-mailadres");
    if (p.sellers.some((s) => s.user_id === buyer!.id)) throw new HttpError(400, "Koper en verkoper zijn dezelfde persoon");
  }
  const buyerLabel = buyer?.name ?? body.buyer_name ?? body.buyer_email!;
  const { entryIds, callId, callOgm, sellerNames } = await bookSettlement(c.env, user.id, b.id, unitId, p, refund, buyerLabel, body);
  // dezelfde afrekening in elke deelvereniging waarin de kavel zit (eigen werkkapitaal, art. 3.84 en 3.94 §5), vóór de eigenaars meeschuiven
  const subResults: { building_id: string; name: string; refund: number; ogm: string | null; skipped?: string }[] = [];
  for (const ch of (await c.env.DB.prepare("SELECT u.id, u.building_id, bb.name FROM units u JOIN buildings bb ON bb.id = u.building_id WHERE u.parent_unit_id = ?").bind(unitId).all<any>()).results) {
    try {
      const cp = await settlementPreview(c.env, ch.building_id, ch.id, body.transfer_date);
      const r = await bookSettlement(c.env, user.id, ch.building_id, ch.id, cp, cp.working_refund, buyerLabel, body);
      await c.env.DB.prepare("INSERT INTO unit_transfers (id, building_id, unit_id, transfer_date, act_date, notary, seller_ids, seller_names, buyer_user_id, buyer_name, buyer_email, fiscal_year_id, working_called, working_refund, reserve_paid, arrears_working, arrears_reserve, fees, entry_ids, call_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(uid(), ch.building_id, ch.id, body.transfer_date, body.act_date ?? null, body.notary ?? null, JSON.stringify(cp.sellers.map((s) => s.user_id)), r.sellerNames, buyer?.id ?? null, buyer?.name ?? body.buyer_name ?? null, buyer?.email ?? body.buyer_email ?? null, cp.fiscal_year.id, cp.working_called, cp.working_refund, cp.reserve_paid, cp.arrears_working, cp.arrears_reserve, cp.fees, JSON.stringify(r.entryIds), r.callId, user.id).run();
      subResults.push({ building_id: ch.building_id, name: ch.name, refund: cp.working_refund, ogm: r.callOgm });
    } catch (e) { subResults.push({ building_id: ch.building_id, name: ch.name, refund: 0, ogm: null, skipped: (e as Error).message }); }
  }
  // 3. Eigenaarswissel: koper wordt eigenaar (of krijgt een uitnodiging gekoppeld aan de kavel); lasthebber vervalt; verkopers zonder andere kavel verlaten de VME
  let inviteId: string | null = null; let inviteToken: string | null = null;
  const stmts = [c.env.DB.prepare("DELETE FROM unit_owners WHERE unit_id = ?").bind(unitId), c.env.DB.prepare("UPDATE units SET representative_user_id = NULL, representative_set_at = NULL, representative_document_id = NULL WHERE id = ?").bind(unitId)];
  if (buyer) stmts.push(c.env.DB.prepare("INSERT INTO unit_owners (unit_id, user_id, share_pct) VALUES (?,?,100)").bind(unitId, buyer.id), c.env.DB.prepare("UPDATE building_members SET role = 'eigenaar' WHERE building_id = ? AND user_id = ? AND role = 'huurder'").bind(b.id, buyer.id));
  else {
    inviteId = uid(); inviteToken = randomToken(24);
    stmts.push(c.env.DB.prepare("INSERT INTO invites (id, building_id, email, name, role, unit_id, token, invited_by, expires_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(inviteId, b.id, body.buyer_email!.toLowerCase(), body.buyer_name ?? null, "eigenaar", unitId, inviteToken, user.id, plusMs(1000 * 60 * 60 * 24 * 30)));
  }
  await c.env.DB.batch(stmts);
  await syncChildUnits(c.env.DB, unitId);
  const removed: string[] = [];
  if (body.remove_sellers) for (const s of p.sellers) {
    const other = await c.env.DB.prepare("SELECT 1 FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE un.building_id = ? AND uo.user_id = ?").bind(b.id, s.user_id).first();
    if (!other) { const r = await c.env.DB.prepare("DELETE FROM building_members WHERE building_id = ? AND user_id = ? AND role = 'eigenaar'").bind(b.id, s.user_id).run(); if (r.meta.changes) removed.push(s.name); }
  }
  // 4. Afrekening als PDF bij de kavel (koper en organen; de syndicus bezorgt ze aan de notaris)
  const pdf = await Pdf.create(`${b.name} - Afrekening overdracht kavel ${p.unit.label}`, pdfOpts((await c.env.DB.prepare("SELECT enterprise_number, dissolution_status FROM buildings WHERE id = ?").bind(b.id).first<any>()) ?? {}));
  pdf.title(`Afrekening bij overdracht - kavel ${p.unit.label}`);
  pdf.text(`Vereniging van mede-eigenaars ${b.name}. Opgesteld door de syndicus op ${dateNl(now())} (art. 3.94 §5 BW).`);
  pdf.h2("Partijen");
  pdf.table([{ label: "", w: 0.35 }, { label: "", w: 0.65 }], [["Verkoper(s)", sellerNames], ["Koper", buyer ? `${buyer.name} (${buyer.email})` : `${body.buyer_name ?? ""} ${body.buyer_email} (uitgenodigd)`.trim()], ["Overdrachtsdatum (gebruik gemene delen)", dateNl(body.transfer_date)], ["Authentieke akte", body.act_date ? dateNl(body.act_date) : "nog niet meegedeeld"], ["Notaris", body.notary ?? "-"], ["Kavel", `${p.unit.label} (${p.unit.shares} aandelen)`]]);
  pdf.h2("Werkkapitaal (art. 3.94 §5, 1°)");
  pdf.table([{ label: "Omschrijving", w: 0.7 }, { label: "Bedrag", w: 0.3, align: "right" }], [[`Opgevraagd werkkapitaal boekjaar ${p.fiscal_year.label} voor deze kavel`, money(p.working_called)], [`Pro rata na de overdracht: ${p.days_after} van ${p.fy_days} dagen`, money(p.working_refund)], ["Afrekening door de syndicus (terug aan verkoper, op te vragen bij koper)", money(refund)]], { totalRow: true });
  if (callOgm) pdf.text(`De koper betaalt ${money(refund)} op ${p.iban ?? "de rekening werkkapitaal van de VME"} met mededeling ${callOgm}. Na ontvangst betaalt de VME hetzelfde bedrag terug aan de verkoper.`, 10, { bold: true });
  pdf.h2("Reservekapitaal (art. 3.94 §5, 2°)");
  pdf.text(`Door deze kavel tot de overdrachtsdatum ingebracht in het reservekapitaal: ${money(p.reserve_paid)}. Dit aandeel blijft eigendom van de vereniging en wordt niet terugbetaald.`);
  pdf.h2("Achterstallen van de verkoper (art. 3.95)");
  pdf.table([{ label: "Omschrijving", w: 0.7 }, { label: "Bedrag", w: 0.3, align: "right" }], [["Achterstal werkkapitaal", money(p.arrears_working)], ["Achterstal reservekapitaal", money(p.arrears_reserve)], ["waarvan aangerekende herinneringskosten", money(p.fees)], ["Af te houden door de notaris bij het verlijden van de akte", money(p.arrears_total)]], { totalRow: true });
  if (subResults.length) { pdf.h2("Deelverenigingen (art. 3.84 BW)"); pdf.table([{ label: "Deelvereniging", w: 0.5 }, { label: "Werkkapitaal", w: 0.2, align: "right" }, { label: "Mededeling", w: 0.3 }], subResults.map((r) => [r.name, r.skipped ? "-" : money(r.refund), r.skipped ? "niet afgerekend: geen boekjaar" : r.ogm ?? "-"])); }
  if (p.pending_decisions.length) { pdf.h2("Beslissingen vóór de overdracht (art. 3.94 §2)"); pdf.text("Behoudens andersluidende afspraak tussen partijen draagt de koper de kosten van werken waartoe vóór de overdracht werd beslist, maar die pas nadien worden opgevraagd."); pdf.table([{ label: "Datum", w: 0.2 }, { label: "Beslissing", w: 0.8 }], p.pending_decisions.map((d) => [dateNl(d.decided_on), d.title])); }
  const docId = await storeDocument(c.env, b.id, user.id, { name: `Afrekening overdracht kavel ${p.unit.label} ${body.transfer_date}.pdf`, bytes: await pdf.bytes(), mime: "application/pdf", category: "overdracht", description: `Afrekening bij overdracht van kavel ${p.unit.label} van ${sellerNames} (art. 3.94 §5 BW)`, folderMatch: /boekhouding/i, unitId });
  const id = uid();
  await c.env.DB.prepare("INSERT INTO unit_transfers (id, building_id, unit_id, transfer_date, act_date, notary, seller_ids, seller_names, buyer_user_id, buyer_name, buyer_email, invite_id, fiscal_year_id, working_called, working_refund, reserve_paid, arrears_working, arrears_reserve, fees, entry_ids, call_id, document_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, unitId, body.transfer_date, body.act_date ?? null, body.notary ?? null, JSON.stringify(p.sellers.map((s) => s.user_id)), sellerNames, buyer?.id ?? null, buyer?.name ?? body.buyer_name ?? null, buyer?.email ?? body.buyer_email ?? null, inviteId, p.fiscal_year.id, p.working_called, refund, p.reserve_paid, p.arrears_working, p.arrears_reserve, p.fees, JSON.stringify(entryIds), callId, docId, user.id).run();
  await audit(c.env, b.id, user.id, "unit.transfer", "unit", unitId, { sellers: sellerNames, buyer: buyer?.id ?? body.buyer_email, refund, arrears: p.arrears_total });
  if (buyer) await notifyBuilding(c.env, { buildingId: b.id, type: "transfer", title: `Welkom als eigenaar van kavel ${p.unit.label}`, body: refund > 0 ? `De afrekening bij de overdracht staat bij je documenten. Te betalen werkkapitaal: € ${refund.toFixed(2)} met mededeling ${callOgm}.` : "De afrekening bij de overdracht staat bij je documenten.", link: `/b/${b.id}/documents`, userIds: [buyer.id] });
  await notifyBuilding(c.env, { buildingId: b.id, type: "transfer", title: `Kavel ${p.unit.label} overgedragen`, body: `Van ${sellerNames} aan ${buyer?.name ?? body.buyer_name ?? body.buyer_email} op ${body.transfer_date}.`, link: `/b/${b.id}/members?tab=units`, roles: ["raad", "commissaris"], excludeUserId: user.id, email: false });
  return c.json({ id, document_id: docId, call_id: callId, ogm: callOgm, refund, sub_associations: subResults, arrears_total: p.arrears_total, removed_sellers: removed, invite_token: c.env.TEST_MODE === "1" ? inviteToken : undefined }, 201);
});
