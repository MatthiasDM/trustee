import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { addMonths } from "../lib/decisions";

/**
 * Ontbinding en vereffening (art. 3.97 en 3.98 BW, tekst geverifieerd 2026-10-17).
 * - Ontbonden zodra de onverdeeldheid ophoudt; de volledige vernietiging van het gebouw volstaat niet.
 * - De AV ontbindt enkel met eenparigheid van alle mede-eigenaars, vastgesteld bij authentieke akte; of de rechter op verzoek van een belanghebbende.
 * - Na ontbinding bestaat de VME voort voor haar vereffening; alle stukken vermelden dat ze in vereffening is.
 * - De AV wijst één of meer vereffenaars aan; anders is de syndicus belast met de vereffening.
 * - Afsluiting bij notariële akte, met de plaats waar de boeken en bescheiden minstens 5 jaar bewaard worden en de consignatie
 *   van niet-uitgekeerde gelden; rechtsvorderingen verjaren 5 jaar na de overschrijving van die akte.
 */
export const dissolution = new Hono<AppEnv>();
dissolution.use("*", requireAuth);

dissolution.get("/:buildingId/dissolution", requireBuilding(), async (c) => {
  const b = await c.env.DB.prepare("SELECT dissolution_status, dissolution_ground, dissolved_at, dissolution_item_id, dissolution_document_id, liquidator_user_id, liquidator_name, archive_place, consignment_note, closing_act_document_id, closed_at, transcribed_at, (SELECT name FROM users WHERE id = buildings.liquidator_user_id) AS liquidator_user_name FROM buildings WHERE id = ?").bind(c.get("building").id).first<any>();
  return c.json({ ...b, liquidator_label: b?.liquidator_user_name ?? b?.liquidator_name ?? (b?.dissolution_status ? "de syndicus (geen vereffenaar aangewezen, art. 3.98 §2)" : null), prescription_until: b?.transcribed_at ? addMonths(b.transcribed_at, 60) : null });
});

/** Ontbinding registreren (syndicus). */
dissolution.post("/:buildingId/dissolution", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({
    ground: z.enum(["end_of_indivision", "av_unanimous", "court"]),
    dissolved_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    item_id: z.string().nullable().optional(), document_id: z.string().nullable().optional(),
    liquidator_user_id: z.string().nullable().optional(), liquidator_name: z.string().max(200).nullable().optional(),
  }).parse(await c.req.json());
  const cur = await c.env.DB.prepare("SELECT dissolution_status FROM buildings WHERE id = ?").bind(b.id).first<any>();
  if (cur?.dissolution_status) throw new HttpError(400, "De ontbinding is al geregistreerd");
  if (body.ground === "av_unanimous") {
    const it = body.item_id ? await c.env.DB.prepare("SELECT required_majority, adopted, status FROM agenda_items WHERE id = ? AND building_id = ?").bind(body.item_id, b.id).first<any>() : null;
    if (!it || it.status !== "decided" || it.adopted !== 1 || it.required_majority !== "unanimous") throw new HttpError(400, "De AV ontbindt enkel met eenparigheid van alle mede-eigenaars: kies die aangenomen beslissing (art. 3.97 BW)");
    if (!body.document_id) throw new HttpError(400, "De beslissing tot ontbinding wordt bij authentieke akte vastgesteld: koppel de akte (art. 3.97 BW)");
  }
  if (body.ground === "court" && !body.document_id) throw new HttpError(400, "Koppel het vonnis dat de ontbinding uitspreekt (art. 3.97 BW)");
  if (body.liquidator_user_id) {
    const m = await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(body.liquidator_user_id).first();
    if (!m) throw new HttpError(400, "Vereffenaar niet gevonden");
  }
  await c.env.DB.prepare("UPDATE buildings SET dissolution_status = 'in_liquidation', dissolution_ground = ?, dissolved_at = ?, dissolution_item_id = ?, dissolution_document_id = ?, liquidator_user_id = ?, liquidator_name = ? WHERE id = ?")
    .bind(body.ground, body.dissolved_at, body.item_id ?? null, body.document_id ?? null, body.liquidator_user_id ?? null, body.liquidator_name ?? null, b.id).run();
  await audit(c.env, b.id, user.id, "vme.dissolved", "building", b.id, body);
  await notifyBuilding(c.env, { buildingId: b.id, type: "dissolution", title: `${b.name} is ontbonden en in vereffening`, body: `De vereniging van mede-eigenaars is ontbonden op ${body.dissolved_at} en bestaat voort voor haar vereffening (art. 3.98 BW).`, link: `/b/${b.id}/settings`, excludeUserId: user.id });
  return c.json({ ok: true });
});

/** Vereffenaar wijzigen of de vereffening afsluiten (syndicus of vereffenaar, die tijdens de vereffening syndicusrechten heeft). */
dissolution.patch("/:buildingId/dissolution", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({
    liquidator_user_id: z.string().nullable().optional(), liquidator_name: z.string().max(200).nullable().optional(),
    close: z.boolean().optional(), archive_place: z.string().min(5).max(500).optional(), consignment_note: z.string().max(2000).optional(),
    closing_act_document_id: z.string().optional(), closed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), transcribed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(await c.req.json());
  const cur = await c.env.DB.prepare("SELECT dissolution_status FROM buildings WHERE id = ?").bind(b.id).first<any>();
  if (cur?.dissolution_status !== "in_liquidation") throw new HttpError(400, "Deze VME is niet in vereffening");
  if (body.liquidator_user_id !== undefined || body.liquidator_name !== undefined) await c.env.DB.prepare("UPDATE buildings SET liquidator_user_id = COALESCE(?, liquidator_user_id), liquidator_name = COALESCE(?, liquidator_name) WHERE id = ?").bind(body.liquidator_user_id ?? null, body.liquidator_name ?? null, b.id).run();
  if (body.close) {
    if (!body.archive_place || !body.closing_act_document_id || !body.closed_at) throw new HttpError(400, "Voor de afsluiting zijn nodig: de notariële slotakte, de datum en de plaats waar de boeken en bescheiden minstens 5 jaar bewaard worden (art. 3.98 §4 BW)");
    await c.env.DB.prepare("UPDATE buildings SET dissolution_status = 'closed', archive_place = ?, consignment_note = ?, closing_act_document_id = ?, closed_at = ?, transcribed_at = ? WHERE id = ?").bind(body.archive_place, body.consignment_note ?? null, body.closing_act_document_id, body.closed_at, body.transcribed_at ?? null, b.id).run();
    await audit(c.env, b.id, user.id, "vme.liquidation_closed", "building", b.id, { archive_place: body.archive_place });
    await notifyBuilding(c.env, { buildingId: b.id, type: "dissolution", title: `Vereffening afgesloten: ${b.name}`, body: `De boeken en bescheiden worden minstens 5 jaar bewaard: ${body.archive_place}. Het platform blijft beschikbaar voor inzage en export.`, link: `/b/${b.id}/settings`, excludeUserId: user.id });
  } else await audit(c.env, b.id, user.id, "vme.liquidator", "building", b.id, body);
  return c.json({ ok: true, at: now() });
});
