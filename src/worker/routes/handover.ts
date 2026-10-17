import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now, randomToken } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

/**
 * Wissel van syndicuskantoor (ook midden in een boekjaar). Het huidige kantoor maakt een eenmalige code aan; een beheerder van het nieuwe kantoor
 * neemt het gebouw ermee over. De VME blijft dezelfde: leden, kavels, documenten, boekhouding en het lopende boekjaar gaan mee. Dat dekt de plicht
 * van de uittredende syndicus om binnen 30 dagen het volledige dossier over te dragen (art. 3.89 §5, 7° BW). Het mandaat van de nieuwe syndicus
 * registreer je daarna onder Mandaten (met de AV-beslissing).
 */
export const handover = new Hono<AppEnv>();
handover.use("*", requireAuth);

handover.post("/:buildingId/handover", requireBuilding("syndicus"), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const code = randomToken(10).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  await c.env.KV.put(`handover:${code}`, JSON.stringify({ building_id: b.id, from_org: b.org_id, by: user.id, at: now() }), { expirationTtl: 14 * 86400 });
  await audit(c.env, b.id, user.id, "building.handover_code", "building", b.id);
  return c.json({ code, expires_in_days: 14 }, 201);
});

handover.post("/handover/accept", async (c) => {
  const user = c.get("user");
  const { code, org_id } = z.object({ code: z.string().min(6).max(20), org_id: z.string() }).parse(await c.req.json());
  const m = await c.env.DB.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").bind(org_id, user.id).first<{ role: string }>();
  if (!m || !["owner", "admin"].includes(m.role)) throw new HttpError(403, "Enkel een beheerder van het nieuwe kantoor kan een gebouw overnemen");
  const raw = await c.env.KV.get(`handover:${code.toUpperCase()}`);
  if (!raw) throw new HttpError(400, "Ongeldige of verlopen overdrachtscode");
  const h = JSON.parse(raw) as { building_id: string; from_org: string };
  if (h.from_org === org_id) throw new HttpError(400, "Het gebouw hoort al bij dit kantoor");
  const b = await c.env.DB.prepare("SELECT id, name, org_id FROM buildings WHERE id = ?").bind(h.building_id).first<any>();
  if (!b || b.org_id !== h.from_org) throw new HttpError(400, "Het gebouw is intussen al overgedragen");
  const oldOrg = await c.env.DB.prepare("SELECT name FROM orgs WHERE id = ?").bind(h.from_org).first<{ name: string }>();
  const newOrg = await c.env.DB.prepare("SELECT name FROM orgs WHERE id = ?").bind(org_id).first<{ name: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE buildings SET org_id = ? WHERE id = ? OR parent_building_id = ?").bind(org_id, b.id, b.id),
    // medewerkers van het oude kantoor verliezen hun syndicusrechten (tenzij ze ook bij het nieuwe kantoor horen)
    c.env.DB.prepare("DELETE FROM building_members WHERE building_id IN (SELECT id FROM buildings WHERE id = ?1 OR parent_building_id = ?1) AND role = 'syndicus' AND user_id IN (SELECT user_id FROM org_members WHERE org_id = ?2) AND user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = ?3)").bind(b.id, h.from_org, org_id),
    c.env.DB.prepare("INSERT INTO building_members (building_id, user_id, role) VALUES (?, ?, 'syndicus') ON CONFLICT(building_id, user_id) DO UPDATE SET role = 'syndicus'").bind(b.id, user.id),
  ]);
  await c.env.KV.delete(`handover:${code.toUpperCase()}`);
  await audit(c.env, b.id, user.id, "building.handover", "building", b.id, { from: oldOrg?.name, to: newOrg?.name });
  await notifyBuilding(c.env, { buildingId: b.id, type: "member", title: `Nieuw syndicuskantoor voor ${b.name}`, body: `Het beheer gaat over van ${oldOrg?.name ?? "het vorige kantoor"} naar ${newOrg?.name}. Alle documenten, de boekhouding en het lopende boekjaar blijven beschikbaar.`, link: `/b/${b.id}`, excludeUserId: user.id });
  return c.json({ building_id: b.id });
});
