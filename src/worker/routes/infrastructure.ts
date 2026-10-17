import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { isBoard, isCoOwner, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { addMonths } from "../lib/decisions";

/**
 * Kabels, leidingen en faciliteiten voor energie, water of telecommunicatie in de gemeenschappelijke delen (art. 3.82 §2 BW, tekst geverifieerd 2026-10-17).
 * Aankondiging minstens 2 maanden vooraf per aangetekende zending aan de syndicus (beschrijving en rechtvaardiging); verzet binnen 2 maanden na ontvangst,
 * op straffe van verval, enkel op grond van een rechtmatig belang (infrastructuur bestaat al; belangrijke schade aan uitzicht, gebruik, hygiëne of veiligheid;
 * geen optimalisatie of verzwaring van de lasten van anderen). De VME of de mede-eigenaars kunnen beslissen zelf te optimaliseren: aanvang binnen 6 maanden.
 */
export const infrastructure = new Hono<AppEnv>();
infrastructure.use("*", requireAuth);
export const OBJECTION_GROUNDS: Record<string, string> = { existing: "Er bevindt zich al zulke infrastructuur in de betrokken gemeenschappelijke delen", damage: "Belangrijke schade aan het uitzicht, het gebruik, de hygiëne of de veiligheid van de gemeenschappelijke delen", no_optimisation: "Geen optimalisatie, of verzwaring van de financiële lasten van andere mede-eigenaars of gebruikers" };

function withTerms(w: any) {
  const deadline = w.received_at ? addMonths(w.received_at, 2) : null;
  const ownWorksDeadline = w.own_works_at ? addMonths(w.own_works_at, 6) : null;
  const today = new Date().toISOString().slice(0, 10);
  const status = w.progress === "withdrawn" ? "withdrawn" : w.objected_at ? "objected" : w.own_works_at ? "own_works" : !w.received_at ? "awaiting_receipt" : today <= deadline! ? "objection_period" : "allowed";
  const label = { withdrawn: "Ingetrokken", objected: "Verzet aangetekend", own_works: `VME voert zelf uit (aanvang vóór ${ownWorksDeadline})`, awaiting_receipt: "Wacht op ontvangst van de aangetekende zending door de syndicus", objection_period: `Verzet mogelijk tot ${deadline}`, allowed: "Toegestaan: geen verzet binnen twee maanden" }[status];
  return { ...w, objection_deadline: deadline, own_works_deadline: ownWorksDeadline, status, status_label: label, objection_ground_label: w.objection_ground ? OBJECTION_GROUNDS[w.objection_ground] : null };
}

infrastructure.get("/:buildingId/infrastructure", requireBuilding(), async (c) => {
  const rows = (await c.env.DB.prepare("SELECT w.*, u.name AS submitted_by_name, ob.name AS objected_by_name FROM infrastructure_works w LEFT JOIN users u ON u.id = w.submitted_by LEFT JOIN users ob ON ob.id = w.objected_by WHERE w.building_id = ? ORDER BY w.created_at DESC").bind(c.get("building").id).all()).results;
  return c.json({ items: rows.map(withTerms), grounds: OBJECTION_GROUNDS });
});

/** Aankondiging door een mede-eigenaar (zelf) of door de syndicus voor een nutsoperator. */
infrastructure.post("/:buildingId/infrastructure", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({ domain: z.enum(["energie", "water", "telecommunicatie"]), description: z.string().min(10).max(3000), justification: z.string().min(10).max(3000), sender_address: z.string().min(5).max(300), planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), operator_name: z.string().max(160).nullable().optional(), received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(await c.req.json());
  const operator = !!body.operator_name;
  if (operator && b.role !== "syndicus") throw new HttpError(403, "Een aankondiging van een nutsoperator registreert de syndicus");
  if (!operator && !isCoOwner(b)) throw new HttpError(403, "Enkel mede-eigenaars of erkende nutsoperatoren hebben dit recht (art. 3.82 §2 BW)");
  if (body.planned_start && body.received_at && body.planned_start < addMonths(body.received_at, 2)) throw new HttpError(400, "De werken mogen pas twee maanden na ontvangst van de aangetekende zending beginnen");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO infrastructure_works (id, building_id, submitted_by, operator_name, sender_address, domain, description, justification, planned_start, received_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, b.id, operator ? null : user.id, body.operator_name ?? null, body.sender_address, body.domain, body.description, body.justification, body.planned_start ?? null, b.role === "syndicus" ? body.received_at ?? null : null).run();
  await audit(c.env, b.id, user.id, "infrastructure.announce", "infrastructure", id, { domain: body.domain, operator: body.operator_name ?? null });
  await notifyBuilding(c.env, { buildingId: b.id, type: "infrastructure", title: `Aangekondigde werken (${body.domain}): ${body.operator_name ?? user.name}`, body: `${body.description.slice(0, 200)} — Verzet is mogelijk binnen twee maanden na ontvangst van de aangetekende zending (art. 3.82 §2 BW).`, link: `/b/${b.id}/infrastructure`, excludeUserId: user.id, email: false });
  return c.json({ id }, 201);
});

infrastructure.patch("/:buildingId/infrastructure/:id", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const w = await c.env.DB.prepare("SELECT * FROM infrastructure_works WHERE id = ? AND building_id = ?").bind(c.req.param("id"), b.id).first<any>();
  if (!w) throw new HttpError(404, "Niet gevonden");
  const body = z.object({
    received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    objection_ground: z.enum(["existing", "damage", "no_optimisation"]).optional(), objection_note: z.string().max(2000).optional(),
    own_works: z.boolean().optional(), progress: z.enum(["started", "done", "withdrawn"]).optional(),
  }).parse(await c.req.json());
  const t = withTerms(w); const today = new Date().toISOString().slice(0, 10);
  if (body.received_at !== undefined) {
    if (b.role !== "syndicus") throw new HttpError(403, "De syndicus registreert de ontvangst van de aangetekende zending");
    await c.env.DB.prepare("UPDATE infrastructure_works SET received_at = ? WHERE id = ?").bind(body.received_at, w.id).run();
  }
  if (body.objection_ground) {
    // verzet door de VME (syndicus of raad) of door een mede-eigenaar, binnen twee maanden na ontvangst, op straffe van verval
    if (!isBoard(b.role) && !isCoOwner(b)) throw new HttpError(403, "Enkel mede-eigenaars of de VME kunnen verzet aantekenen");
    if (w.submitted_by === user.id) throw new HttpError(400, "Je kan geen verzet aantekenen tegen je eigen werken");
    if (!w.received_at) throw new HttpError(400, "De termijn loopt pas vanaf de ontvangst van de aangetekende zending; registreer eerst de ontvangst");
    if (today > t.objection_deadline) throw new HttpError(400, `De termijn voor verzet verstreek op ${t.objection_deadline} (art. 3.82 §2 BW: op straffe van verval)`);
    await c.env.DB.prepare("UPDATE infrastructure_works SET objection_ground = ?, objection_note = ?, objected_at = ?, objected_by = ? WHERE id = ?").bind(body.objection_ground, body.objection_note ?? null, now(), user.id, w.id).run();
    if (w.submitted_by) await notifyBuilding(c.env, { buildingId: b.id, type: "infrastructure", title: "Verzet tegen je aangekondigde werken", body: `${user.name}: ${OBJECTION_GROUNDS[body.objection_ground]}. Stuur het verzet ook aangetekend; de wet vraagt een aangetekende zending aan de afzender.`, link: `/b/${b.id}/infrastructure`, userIds: [w.submitted_by] });
  }
  if (body.own_works) {
    if (!isBoard(b.role) || b.role === "commissaris") throw new HttpError(403, "De syndicus of de raad registreert dat de VME zelf optimaliseert");
    await c.env.DB.prepare("UPDATE infrastructure_works SET own_works_at = ? WHERE id = ?").bind(today, w.id).run();
  }
  if (body.progress) {
    if (w.submitted_by !== user.id && b.role !== "syndicus") throw new HttpError(403, "Enkel de aanvrager of de syndicus werkt de voortgang bij");
    if (body.progress === "started" && t.status !== "allowed") throw new HttpError(400, `De werken mogen nog niet beginnen: ${t.status_label}`);
    await c.env.DB.prepare("UPDATE infrastructure_works SET progress = ? WHERE id = ?").bind(body.progress, w.id).run();
  }
  await audit(c.env, b.id, user.id, "infrastructure.update", "infrastructure", w.id, body);
  return c.json({ ok: true });
});

/** Cron: syndicus en raad 14 dagen vóór het einde van de verzettermijn verwittigen (eenmalig). */
export async function infrastructureReminders(env: Env) {
  const rows = (await env.DB.prepare("SELECT * FROM infrastructure_works WHERE received_at IS NOT NULL AND objected_at IS NULL AND own_works_at IS NULL AND progress = 'announced'").all<any>()).results;
  let n = 0; const today = new Date().toISOString().slice(0, 10);
  for (const w of rows) {
    const t = withTerms(w); const days = Math.round((new Date(t.objection_deadline).getTime() - new Date(today).getTime()) / 86400_000);
    if (days < 0 || days > 14) continue;
    const key = `infra:objection:${w.id}`; if (await env.KV.get(key)) continue;
    await env.KV.put(key, "1", { expirationTtl: 120 * 86400 });
    await notifyBuilding(env, { buildingId: w.building_id, type: "infrastructure", title: `Nog ${days} dagen voor verzet: werken ${w.domain}`, body: `Verzet tegen de aangekondigde werken kan tot ${t.objection_deadline}, daarna vervalt het recht (art. 3.82 §2 BW).`, link: `/b/${w.building_id}/infrastructure`, roles: ["syndicus", "raad"] });
    n++;
  }
  return n;
}
