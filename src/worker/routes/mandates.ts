import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { isBoard, requireAuth, requireBuilding } from "../lib/auth";
import { canRegisterSyndicus, hasSyndicus, organConflict } from "../lib/governance";
import { Pdf, dateNl, pdfOpts } from "../lib/pdf";
import { reserveCheck } from "../lib/reserve";
import { votingUnits } from "../lib/voting";
import { storeDocument } from "../lib/reports";
import { HttpError, patchOf, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

const mandates = new Hono<AppEnv>();
mandates.use("*", requireAuth);

export const ORGAN_RULES = {
  syndicus: { label: "Syndicus", maxYears: 3, basis: "art. 3.89 §1 BW: mandaat max. 3 jaar, hernieuwbaar bij uitdrukkelijke AV-beslissing" },
  raad: { label: "Raad van mede-eigendom", maxYears: null, basis: "art. 3.90 BW: verplicht vanaf 20 kavels; enkel stemgerechtigde mede-eigenaars; jaarlijks verslag aan de AV" },
  commissaris: { label: "Commissaris van de rekeningen", maxYears: 1, basis: "art. 3.91 BW: jaarlijks door de AV aangewezen; controleert de rekeningen" },
  voorlopig_bewindvoerder: { label: "Voorlopig bewindvoerder", maxYears: 3, basis: "art. 3.92 §2 BW: door de rechter aangewezen als het financieel evenwicht ernstig in het gedrang is of het behoud of de wettelijke overeenstemming van het gebouw niet gewaarborgd kan worden; vervangt de organen voor de toegekende taken" },
  voorlopig_syndicus: { label: "Voorlopig syndicus", maxYears: 3, basis: "art. 3.89 §7 BW (toegevoegd door de AV, voor welbepaalde duur of doeleinden), §8 (aangewezen door de rechter bij verhindering of in gebreke blijven) of §6 (bevoegdheidsoverdracht met toestemming van de AV)" },
} as const;
export const BASIS_LABELS: Record<string, string> = { av: "Toegevoegd door de AV (art. 3.89 §7)", rechter: "Aangewezen door de rechter (art. 3.89 §8)", delegatie: "Bevoegdheidsoverdracht met toestemming van de AV (art. 3.89 §6)" };

mandates.get("/:buildingId/mandates", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = await c.env.DB.prepare(
    `SELECT m.*, u.name AS user_name, u.email AS user_email, mt.title AS meeting_title
     FROM mandates m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN meetings mt ON mt.id = m.appointed_by_meeting_id
     WHERE m.building_id = ? ORDER BY m.end_date DESC`
  ).bind(b.id).all();
  const units = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM units WHERE building_id = ? AND type NOT IN ('garage','berging','kelder','parkeerplaats')").bind(b.id).first<{ n: number }>();
  return c.json({ mandates: rows.results, rules: ORGAN_RULES, raad_required: (units?.n ?? 0) >= 20, counted_units: units?.n ?? 0 });
});

const schema = z.object({
  organ: z.enum(["syndicus", "raad", "commissaris", "voorlopig_syndicus", "voorlopig_bewindvoerder"]),
  basis: z.enum(["av", "rechter", "delegatie"]).nullable().optional(),
  scope: z.string().max(2000).nullable().optional(),
  document_id: z.string().nullable().optional(),
  extract_posted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  user_id: z.string().nullable().optional(),
  holder_name: z.string().max(160).nullable().optional(),
  function_title: z.string().max(80).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointed_by_meeting_id: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function validate(body: z.infer<typeof schema>) {
  if (!body.user_id && !body.holder_name) throw new HttpError(400, "Kies een lid of vul een naam in");
  if (body.end_date <= body.start_date) throw new HttpError(400, "Einddatum moet na startdatum liggen");
  if (body.organ === "voorlopig_bewindvoerder" && (body.basis !== "rechter" || !body.document_id || !body.scope)) throw new HttpError(400, "Een voorlopig bewindvoerder wordt aangewezen door de rechter: kies die grond, koppel het vonnis en vermeld de toegekende taken (art. 3.92 §2 BW)");
  if (body.organ === "voorlopig_bewindvoerder" && !body.user_id) throw new HttpError(400, "De bewindvoerder moet een lid van het platform zijn om zijn taken uit te voeren");
  if (body.organ === "voorlopig_syndicus" && !body.basis) throw new HttpError(400, "Kies de rechtsgrond: AV-beslissing (art. 3.89 §7), vonnis van de rechter (§8) of bevoegdheidsoverdracht (§6)");
  if (body.organ === "voorlopig_syndicus" && !body.user_id) throw new HttpError(400, "Een voorlopig syndicus moet een lid van het platform zijn, anders kan hij niets uitvoeren");
  const max = ORGAN_RULES[body.organ].maxYears;
  if (max) {
    const limit = new Date(body.start_date); limit.setFullYear(limit.getFullYear() + max);
    if (new Date(body.end_date) > limit) throw new HttpError(400, `Het mandaat van ${ORGAN_RULES[body.organ].label.toLowerCase()} mag maximaal ${max} jaar duren (${ORGAN_RULES[body.organ].basis})`);
  }
}

mandates.post("/:buildingId/mandates", requireBuilding(), async (c) => {
  // Organen registreren mandaten. Zonder syndicus mag ook de voorzitter van de laatste AV of een ondertekenaar van een bereikt
  // verzoek "syndicus aanwijzen" de (voorlopig) syndicus registreren, zodat de VME nooit vastzit (art. 3.87 §2, lid 4 BW).
  {
    const b0 = c.get("building"); const u0 = c.get("user"); const peek = (await c.req.raw.clone().json().catch(() => ({}))) as { organ?: string };
    const syndicusType = peek?.organ === "syndicus" || peek?.organ === "voorlopig_syndicus" || peek?.organ === "voorlopig_bewindvoerder";
    if (!isBoard(b0.role) && !(syndicusType && (await canRegisterSyndicus(c.env, b0, u0.id)))) throw new HttpError(403, "Onvoldoende rechten");
  }
  const b = c.get("building");
  const body = schema.parse(await c.req.json());
  validate(body);
  if (body.user_id) { const clash = await organConflict(c.env, b.id, body.user_id, body.organ, body.start_date, body.end_date); if (clash) throw new HttpError(400, clash); }
  if (body.organ === "raad" && body.user_id) {
    const m = await c.env.DB.prepare("SELECT role FROM building_members WHERE building_id = ? AND user_id = ?").bind(b.id, body.user_id).first<{ role: string }>();
    if (m?.role === "huurder") throw new HttpError(400, "Enkel stemgerechtigde mede-eigenaars kunnen in de raad zetelen (art. 3.90 BW)");
  }
  const id = uid();
  await c.env.DB.prepare("INSERT INTO mandates (id, building_id, organ, user_id, holder_name, function_title, start_date, end_date, appointed_by_meeting_id, notes, basis, scope, document_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, body.organ, body.user_id ?? null, body.holder_name ?? null, body.function_title ?? null, body.start_date, body.end_date, body.appointed_by_meeting_id ?? null, body.notes ?? null, body.basis ?? null, body.scope ?? null, body.document_id ?? null).run();
  // rol van het lid automatisch afstemmen op het mandaat
  if (body.user_id && !["syndicus", "voorlopig_syndicus", "voorlopig_bewindvoerder"].includes(body.organ)) await c.env.DB.prepare("UPDATE building_members SET role = ? WHERE building_id = ? AND user_id = ? AND role IN ('eigenaar','raad','commissaris')").bind(body.organ, b.id, body.user_id).run();
  if (body.user_id && body.organ === "syndicus") await c.env.DB.prepare("INSERT INTO building_members (building_id, user_id, role) VALUES (?, ?, 'syndicus') ON CONFLICT(building_id, user_id) DO UPDATE SET role = 'syndicus'").bind(b.id, body.user_id).run();
  await audit(c.env, b.id, c.get("user").id, "mandate.create", "mandate", id, { organ: body.organ, end: body.end_date });
  if (body.organ === "syndicus" || body.organ === "voorlopig_syndicus") await notifyBuilding(c.env, { buildingId: b.id, type: "mandate", title: "Uittreksel aanstelling syndicus aanplakken", body: `Binnen 8 dagen na de aanvang van de opdracht (${body.start_date}) moet een uittreksel van de aanstelling zichtbaar aan de ingang van het gebouw hangen (art. 3.89 §2 BW). Maak het aan onder Mede-eigenaars & organen › Mandaten.`, link: `/b/${b.id}/members?tab=mandates`, roles: ["syndicus"], email: false });
  return c.json({ id }, 201);
});

mandates.patch("/:buildingId/mandates/:mandateId", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const existing = await c.env.DB.prepare("SELECT * FROM mandates WHERE id = ? AND building_id = ?").bind(c.req.param("mandateId"), b.id).first<any>();
  if (!existing) throw new HttpError(404, "Mandaat niet gevonden");
  const body = patchOf(schema.partial(), await c.req.json());
  const merged = { ...existing, ...body } as any;
  validate(merged);
  if (merged.user_id) { const clash = await organConflict(c.env, b.id, merged.user_id, merged.organ, merged.start_date, merged.end_date, existing.id); if (clash) throw new HttpError(400, clash); }
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE mandates SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, v]) => v), existing.id).run();
  return c.json({ ok: true });
});

mandates.delete("/:buildingId/mandates/:mandateId", requireBuilding("syndicus"), async (c) => {
  await c.env.DB.prepare("DELETE FROM mandates WHERE id = ? AND building_id = ?").bind(c.req.param("mandateId"), c.get("building").id).run();
  return c.json({ ok: true });
});

/** Overzicht van de organen voor het dashboard. */
mandates.get("/:buildingId/organs", requireBuilding(), async (c) => {
  const b = c.get("building");
  const today = new Date().toISOString().slice(0, 10);
  const active = (await c.env.DB.prepare("SELECT m.*, u.name AS user_name FROM mandates m LEFT JOIN users u ON u.id = m.user_id WHERE m.building_id = ? AND m.start_date <= ? AND m.end_date >= ? ORDER BY m.organ, m.end_date").bind(b.id, today, today).all()).results as any[];
  const nextAv = await c.env.DB.prepare("SELECT id, title, starts_at FROM meetings WHERE building_id = ? AND type IN ('av','bav') AND starts_at >= ? ORDER BY starts_at LIMIT 1").bind(b.id, new Date().toISOString()).first();
  const lastAv = await c.env.DB.prepare("SELECT id, title, starts_at, minutes_document_id FROM meetings WHERE building_id = ? AND type IN ('av','bav') AND starts_at < ? ORDER BY starts_at DESC LIMIT 1").bind(b.id, new Date().toISOString()).first();
  const proposed = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_items WHERE building_id = ? AND status = 'proposed'").bind(b.id).first<{ n: number }>();
  const units = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM units WHERE building_id = ? AND type NOT IN ('garage','berging','kelder','parkeerplaats')").bind(b.id).first<{ n: number }>();
  const info = await c.env.DB.prepare("SELECT av_period_start FROM buildings WHERE id = ?").bind(b.id).first<{ av_period_start: string | null }>();
  const soon = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const byOrgan = (o: string) => active.filter((m) => m.organ === o).map((m) => ({ ...m, name: m.user_name ?? m.holder_name, expiring: m.end_date <= soon }));
  return c.json({
    av: { next: nextAv, last: lastAv, proposed_items: proposed?.n ?? 0, period_start: info?.av_period_start ?? null },
    syndicus: [...byOrgan("voorlopig_bewindvoerder").map((m) => ({ ...m, name: `${m.name} (voorlopig bewindvoerder, door de rechter)` })), ...byOrgan("syndicus"), ...byOrgan("voorlopig_syndicus").map((m) => ({ ...m, name: `${m.name} (voorlopig syndicus${m.basis ? `, ${m.basis === "rechter" ? "door de rechter" : m.basis === "av" ? "door de AV" : "bevoegdheidsoverdracht"}` : ""})` }))],
    raad: byOrgan("raad"), commissaris: byOrgan("commissaris"),
    syndicus_present: await hasSyndicus(c.env, b.id),
    raad_required: (units?.n ?? 0) >= 20,
    warnings: [
      ...await structuralWarnings(c.env, b.id),
      ...await (async () => { const r = await reserveCheck(c.env, b.id); return [...(r.status === "short" ? [r.message] : []), ...(!r.has_working_account || !r.has_reserve_account ? ["Een afzonderlijke rekening voor werkkapitaal en voor reservekapitaal is verplicht, op naam van de VME (art. 3.86 §3 BW); registreer ze onder Boekhouding › Instellingen."] : [])]; })(),
      ...(byOrgan("syndicus").length === 0 ? ["Geen actief syndicusmandaat geregistreerd (art. 3.89 BW)."] : []),
      ...(byOrgan("commissaris").length === 0 ? ["Geen commissaris van de rekeningen aangewezen voor dit jaar (art. 3.91 BW: jaarlijks verplicht)."] : []),
      ...active.filter((m) => (m.organ === "syndicus" || m.organ === "voorlopig_syndicus") && !m.extract_posted_at && new Date(m.start_date).getTime() + 8 * 86400_000 < Date.now()).map((m) => `Het uittreksel van de aanstelling van ${m.user_name ?? m.holder_name} als syndicus is nog niet als aangeplakt geregistreerd; het moet binnen 8 dagen aan de ingang hangen (art. 3.89 §2 BW).`),
      ...((units?.n ?? 0) >= 20 && byOrgan("raad").length === 0 ? ["Raad van mede-eigendom verplicht vanaf 20 kavels, maar nog niet samengesteld (art. 3.90 BW)."] : []),
      ...active.filter((m) => m.end_date <= soon).map((m) => `Mandaat ${ORGAN_RULES[m.organ as keyof typeof ORGAN_RULES].label.toLowerCase()} van ${m.user_name ?? m.holder_name} loopt af op ${new Date(m.end_date).toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "medium" })}; agendeer de herbenoeming op de AV.`),
    ],
  });
});

/**
 * Uittreksel van de aanstelling van de syndicus (art. 3.89 §2 BW) om aan de ingang van het gebouw van de zetel aan te plakken:
 * datum van aanstelling, naam, voornamen, beroep en woonplaats (of rechtsvorm, naam, zetel en KBO), contactgegevens, en waar het reglement
 * van interne orde en het register van de beslissingen geraadpleegd kunnen worden.
 */
mandates.post("/:buildingId/mandates/:mandateId/extract", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await c.env.DB.prepare("SELECT m.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone, mt.title AS meeting_title, mt.starts_at AS meeting_at FROM mandates m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN meetings mt ON mt.id = m.appointed_by_meeting_id WHERE m.id = ? AND m.building_id = ?").bind(c.req.param("mandateId"), b.id).first<any>();
  if (!m || !["syndicus", "voorlopig_syndicus"].includes(m.organ)) throw new HttpError(404, "Syndicusmandaat niet gevonden");
  const bld = await c.env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(b.id).first<any>();
  const info = bld.syndicus_info ? JSON.parse(bld.syndicus_info) : {};
  const name = info.name || m.user_name || m.holder_name;
  const pdf = await Pdf.create(`${bld.name} - Uittreksel aanstelling syndicus`, pdfOpts(bld));
  pdf.title("Uittreksel aanstelling syndicus");
  pdf.text(`Vereniging van mede-eigenaars ${bld.name}${bld.enterprise_number ? `, ondernemingsnummer ${bld.enterprise_number}` : ""}, zetel ${bld.seat_address ?? `${bld.address}${bld.city ? `, ${bld.postal_code ?? ""} ${bld.city}` : ""}`}.`, 10.5);
  pdf.space(6);
  const rows: string[][] = [
    ["Functie", m.organ === "voorlopig_syndicus" ? `Voorlopig syndicus${m.basis === "rechter" ? " (aangewezen door de rechter, art. 3.89 §8 BW)" : m.basis === "av" ? " (toegevoegd door de algemene vergadering, art. 3.89 §7 BW)" : ""}` : "Syndicus"],
    ["Datum van aanstelling", `${dateNl(m.start_date)}${m.meeting_title ? ` (${m.meeting_title})` : ""}`], ["Mandaat tot", dateNl(m.end_date)],
    ["Naam", name ?? "-"], ...(info.legal_form ? [["Rechtsvorm", info.legal_form]] : []), ...(info.profession ? [["Beroep", info.profession]] : []),
    [info.legal_form ? "Maatschappelijke zetel" : "Woonplaats", info.address || "-"], ...(info.enterprise_number ? [["Ondernemingsnummer", info.enterprise_number]] : []),
    ["Telefoon", info.phone || m.user_phone || "-"], ["E-mail", info.email || m.user_email || "-"],
    ["Reglement van interne orde en register van de beslissingen", info.consult_place || `Te raadplegen bij de syndicus en online: ${c.env.APP_URL}/b/${b.id}/decisions`],
  ];
  pdf.table([{ label: "", w: 0.38 }, { label: "", w: 0.62 }], rows);
  pdf.space(10);
  pdf.text("Aan te plakken door de syndicus, binnen acht dagen na de aanvang van de opdracht, op onveranderlijke en altijd zichtbare wijze aan de ingang van het gebouw waar de zetel van de vereniging gevestigd is (art. 3.89 §2 BW).", 8.5);
  const docId = await storeDocument(c.env, b.id, user.id, { name: `Uittreksel aanstelling syndicus ${name ?? ""} ${m.start_date}.pdf`, bytes: await pdf.bytes(), mime: "application/pdf", category: "overig", description: "Aan te plakken aan de ingang (art. 3.89 §2 BW)", folderMatch: /statuten/i });
  await c.env.DB.prepare("UPDATE mandates SET extract_document_id = ? WHERE id = ?").bind(docId, m.id).run();
  await audit(c.env, b.id, user.id, "mandate.extract", "mandate", m.id);
  return c.json({ document_id: docId }, 201);
});

/** Structurele situaties die de werking van de VME raken (zonder of met eigen wetsartikel). */
async function structuralWarnings(env: AppEnv["Bindings"], buildingId: string): Promise<string[]> {
  const out: string[] = [];
  const vunits = await votingUnits(env, buildingId);
  const owned = vunits.filter((u) => u.owners.length);
  const persons = new Set(owned.flatMap((u) => u.owners.map((o) => o.user_id)));
  const allUnits = vunits.length;
  if (allUnits > 0 && owned.length === allUnits && persons.size === 1 && owned.every((u) => !u.split)) out.push("Alle kavels zijn in handen van één eigenaar: de onverdeeldheid houdt op en de VME is van rechtswege ontbonden (art. 3.97 BW). Registreer de ontbinding onder Instellingen › Ontbinding en vereffening.");
  const zero = vunits.filter((u) => !u.shares);
  if (zero.length) out.push(`Kavel ${zero.map((u) => u.label).join(", ")} heeft geen aandelen in de gemeenschappelijke delen: ze stemt niet en draagt geen lasten volgens aandelen. Controleer de basisakte.`);
  const voters = new Set(owned.map((u) => u.voter_id).filter(Boolean));
  if (voters.size === 2) out.push("Er zijn maar twee stemgerechtigden: door het stemplafond beslist geen van beiden alleen (art. 3.87 §8 BW). Raken ze het niet eens, dan kan elk de rechter vragen een AV te laten bijeenroepen (art. 3.92 §4) of toestemming te geven voor dringende werken (art. 3.92 §5).");
  return out;
}

export default mandates;
