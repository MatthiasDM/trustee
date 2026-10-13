import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, uid } from "../lib/util";
import { audit } from "../lib/notify";

const mandates = new Hono<AppEnv>();
mandates.use("*", requireAuth);

export const ORGAN_RULES = {
  syndicus: { label: "Syndicus", maxYears: 3, basis: "art. 3.89 §1 BW: mandaat max. 3 jaar, hernieuwbaar bij uitdrukkelijke AV-beslissing" },
  raad: { label: "Raad van mede-eigendom", maxYears: null, basis: "art. 3.90 BW: verplicht vanaf 20 kavels; enkel stemgerechtigde mede-eigenaars; jaarlijks verslag aan de AV" },
  commissaris: { label: "Commissaris van de rekeningen", maxYears: 1, basis: "art. 3.91 BW: jaarlijks door de AV aangewezen; controleert de rekeningen" },
} as const;

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
  organ: z.enum(["syndicus", "raad", "commissaris"]),
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
  const max = ORGAN_RULES[body.organ].maxYears;
  if (max) {
    const limit = new Date(body.start_date); limit.setFullYear(limit.getFullYear() + max);
    if (new Date(body.end_date) > limit) throw new HttpError(400, `Het mandaat van ${ORGAN_RULES[body.organ].label.toLowerCase()} mag maximaal ${max} jaar duren (${ORGAN_RULES[body.organ].basis})`);
  }
}

mandates.post("/:buildingId/mandates", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const body = schema.parse(await c.req.json());
  validate(body);
  if (body.organ === "raad" && body.user_id) {
    const m = await c.env.DB.prepare("SELECT role FROM building_members WHERE building_id = ? AND user_id = ?").bind(b.id, body.user_id).first<{ role: string }>();
    if (m?.role === "huurder") throw new HttpError(400, "Enkel stemgerechtigde mede-eigenaars kunnen in de raad zetelen (art. 3.90 BW)");
  }
  const id = uid();
  await c.env.DB.prepare("INSERT INTO mandates (id, building_id, organ, user_id, holder_name, function_title, start_date, end_date, appointed_by_meeting_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, body.organ, body.user_id ?? null, body.holder_name ?? null, body.function_title ?? null, body.start_date, body.end_date, body.appointed_by_meeting_id ?? null, body.notes ?? null).run();
  // rol van het lid automatisch afstemmen op het mandaat
  if (body.user_id && body.organ !== "syndicus") await c.env.DB.prepare("UPDATE building_members SET role = ? WHERE building_id = ? AND user_id = ? AND role IN ('eigenaar','raad','commissaris')").bind(body.organ, b.id, body.user_id).run();
  if (body.user_id && body.organ === "syndicus") await c.env.DB.prepare("INSERT INTO building_members (building_id, user_id, role) VALUES (?, ?, 'syndicus') ON CONFLICT(building_id, user_id) DO UPDATE SET role = 'syndicus'").bind(b.id, body.user_id).run();
  await audit(c.env, b.id, c.get("user").id, "mandate.create", "mandate", id, { organ: body.organ, end: body.end_date });
  return c.json({ id }, 201);
});

mandates.patch("/:buildingId/mandates/:mandateId", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building");
  const existing = await c.env.DB.prepare("SELECT * FROM mandates WHERE id = ? AND building_id = ?").bind(c.req.param("mandateId"), b.id).first<any>();
  if (!existing) throw new HttpError(404, "Mandaat niet gevonden");
  const body = schema.partial().parse(await c.req.json());
  validate({ ...existing, ...body });
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
    syndicus: byOrgan("syndicus"), raad: byOrgan("raad"), commissaris: byOrgan("commissaris"),
    raad_required: (units?.n ?? 0) >= 20,
    warnings: [
      ...(byOrgan("syndicus").length === 0 ? ["Geen actief syndicusmandaat geregistreerd (art. 3.89 BW)."] : []),
      ...(byOrgan("commissaris").length === 0 ? ["Geen commissaris van de rekeningen aangewezen voor dit jaar (art. 3.91 BW: jaarlijks verplicht)."] : []),
      ...((units?.n ?? 0) >= 20 && byOrgan("raad").length === 0 ? ["Raad van mede-eigendom verplicht vanaf 20 kavels, maar nog niet samengesteld (art. 3.90 BW)."] : []),
      ...active.filter((m) => m.end_date <= soon).map((m) => `Mandaat ${ORGAN_RULES[m.organ as keyof typeof ORGAN_RULES].label.toLowerCase()} van ${m.user_name ?? m.holder_name} loopt af op ${m.end_date}; agendeer de herbenoeming op de AV.`),
    ],
  });
});

export default mandates;
