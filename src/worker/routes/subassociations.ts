import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { syncChildUnits } from "../lib/subassoc";

/**
 * Deelverenigingen (art. 3.84 BW, tekst geverifieerd 2026-10-17): vanaf twintig kavels kan de basisakte (of de AV met de vereiste meerderheid,
 * art. 3.88 §3) deelverenigingen oprichten voor de kavels van één of meer gebouwen van een groep, of van fysiek duidelijk te onderscheiden
 * onderdelen van een gebouw. Ze zijn enkel bevoegd voor de particulier gemeenschappelijke delen uit de basisakte; de hoofdvereniging blijft
 * exclusief bevoegd voor de algemeen gemeenschappelijke delen en het gemeenschappelijk beheer. Art. 3.84 e.v. gelden voor hen: eigen AV, organen
 * en boekhouding. Rechtspersoonlijkheid pas als de hoofdvereniging die heeft (art. 3.86 §2).
 */
export const subassociations = new Hono<AppEnv>();
subassociations.use("*", requireAuth);

subassociations.get("/:buildingId/sub-associations", requireBuilding(), async (c) => {
  const b = c.get("building");
  const me = await c.env.DB.prepare("SELECT b.parent_building_id, b.sub_scope, b.sub_basis, p.name AS parent_name FROM buildings b LEFT JOIN buildings p ON p.id = b.parent_building_id WHERE b.id = ?").bind(b.id).first<any>();
  const children = (await c.env.DB.prepare("SELECT b.id, b.name, b.sub_scope, b.sub_basis, b.total_shares, (SELECT COUNT(*) FROM units WHERE building_id = b.id) AS units FROM buildings b WHERE b.parent_building_id = ? ORDER BY b.name").bind(b.id).all()).results;
  const units = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM units WHERE building_id = ?").bind(b.id).first<{ n: number }>())?.n ?? 0;
  return c.json({ parent: me?.parent_building_id ? { id: me.parent_building_id, name: me.parent_name, scope: me.sub_scope, basis: me.sub_basis } : null, children, units, allowed: !me?.parent_building_id && units >= 20 });
});

subassociations.post("/:buildingId/sub-associations", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const body = z.object({
    name: z.string().min(3).max(160), scope: z.string().min(5).max(2000),
    basis: z.enum(["basisakte", "av"]), item_id: z.string().nullable().optional(), document_id: z.string().nullable().optional(),
    units: z.array(z.object({ unit_id: z.string(), shares: z.number().int().positive() })).min(2),
  }).parse(await c.req.json());
  const main = await c.env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(b.id).first<any>();
  if (main.parent_building_id) throw new HttpError(400, "Een deelvereniging kan zelf geen deelverenigingen hebben");
  const count = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM units WHERE building_id = ?").bind(b.id).first<{ n: number }>())?.n ?? 0;
  if (count < 20) throw new HttpError(400, `Deelverenigingen zijn enkel mogelijk vanaf twintig kavels; dit gebouw telt er ${count} (art. 3.84 BW)`);
  if (body.basis === "basisakte" && !body.document_id) throw new HttpError(400, "Koppel de basisakte die de deelvereniging opricht");
  if (body.basis === "av") {
    const it = body.item_id ? await c.env.DB.prepare("SELECT adopted, status FROM agenda_items WHERE id = ? AND building_id = ?").bind(body.item_id, b.id).first<any>() : null;
    if (!it || it.status !== "decided" || it.adopted !== 1) throw new HttpError(400, "Kies de aangenomen beslissing van de AV die de deelvereniging opricht (art. 3.88 §3 BW)");
  }
  const ids = [...new Set(body.units.map((u) => u.unit_id))];
  const parents = (await c.env.DB.prepare(`SELECT id, label, type, floor FROM units WHERE building_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(b.id, ...ids).all<any>()).results;
  if (parents.length !== ids.length) throw new HttpError(400, "Alle kavels moeten tot deze vereniging behoren");
  const id = uid(); const total = body.units.reduce((s, u) => s + u.shares, 0);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO buildings (id, org_id, name, address, city, postal_code, total_shares, parent_building_id, sub_scope, sub_basis, sub_basis_item_id, sub_basis_document_id, av_period_start, av_period_days, seat_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, main.org_id, body.name, main.address, main.city, main.postal_code, total, b.id, body.scope, body.basis, body.item_id ?? null, body.document_id ?? null, main.av_period_start, main.av_period_days, main.seat_address),
    c.env.DB.prepare("INSERT INTO building_members (building_id, user_id, role) VALUES (?, ?, 'syndicus')").bind(id, user.id),
    ...["Statuten & basisakte", "Verslagen algemene vergadering", "Boekhouding & afrekeningen", "Offertes & facturen"].map((n) => c.env.DB.prepare("INSERT INTO folders (id, building_id, name) VALUES (?, ?, ?)").bind(uid(), id, n)),
    ...body.units.map((u) => { const p = parents.find((x) => x.id === u.unit_id)!; return c.env.DB.prepare("INSERT INTO units (id, building_id, label, type, floor, shares, parent_unit_id) VALUES (?,?,?,?,?,?,?)").bind(uid(), id, p.label, p.type, p.floor, u.shares, p.id); }),
  ]);
  for (const u of ids) await syncChildUnits(c.env.DB, u);
  await audit(c.env, b.id, user.id, "subassociation.create", "building", id, { name: body.name, units: ids.length });
  await notifyBuilding(c.env, { buildingId: id, type: "member", title: `Deelvereniging opgericht: ${body.name}`, body: `Je kavel maakt deel uit van deze deelvereniging, bevoegd voor: ${body.scope.slice(0, 200)}`, link: `/b/${id}`, excludeUserId: user.id, email: false });
  return c.json({ id }, 201);
});
