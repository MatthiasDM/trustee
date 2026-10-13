import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, uid } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";

const r = new Hono<AppEnv>();
r.use("*", requireAuth);

export const COMPLIANCE_KINDS: Record<string, { label: string; months: number; basis: string }> = {
  lift: { label: "Liftkeuring", months: 3, basis: "KB 9 maart 2003: periodieke inspectie om de 3 maanden (EDTC), risicoanalyse om de 15 jaar" },
  brand: { label: "Brandbestrijdingsmiddelen (blussers, haspels)", months: 12, basis: "Jaarlijks nazicht door een erkend onderhoudsbedrijf" },
  elektriciteit: { label: "Keuring elektrische installatie gemene delen", months: 60, basis: "AREI: om de 5 jaar voor huishoudelijke installaties (gemene delen vaak 5 jaar)" },
  verwarming: { label: "Onderhoud centrale verwarming", months: 12, basis: "Vlaanderen: jaarlijks (stookolie) of tweejaarlijks (gas); verwarmingsaudit om de 5 jaar" },
  gas: { label: "Dichtheidsproef gasinstallatie", months: 60, basis: "Bij werken en volgens de installatievoorschriften" },
  epc: { label: "EPC gemene delen", months: 120, basis: "Vlaanderen: verplicht EPC gemeenschappelijke delen, 10 jaar geldig" },
  asbest: { label: "Asbestattest", months: 120, basis: "Vlaanderen: verplicht bij verkoop voor gebouwen van vóór 2001; 10 jaar geldig" },
  legionella: { label: "Legionellabeheersplan", months: 12, basis: "Bij collectieve warmwaterinstallaties" },
  verzekering: { label: "Verzekeringspolis (brand / BA)", months: 12, basis: "Jaarlijkse vervaldag van de polis" },
  overig: { label: "Andere keuring of attest", months: 12, basis: "" },
};

r.get("/:buildingId/compliance", requireBuilding(), async (c) => {
  const b = c.get("building");
  const rows = (await c.env.DB.prepare("SELECT ci.*, s.name AS supplier_name, d.name AS document_name FROM compliance_items ci LEFT JOIN suppliers s ON s.id = ci.supplier_id LEFT JOIN documents d ON d.id = ci.document_id WHERE ci.building_id = ? ORDER BY ci.next_date").bind(b.id).all()).results as any[];
  const today = new Date().toISOString().slice(0, 10);
  return c.json({ items: rows.map((x) => ({ ...x, days_left: Math.floor((new Date(x.next_date).getTime() - new Date(today).getTime()) / 86400_000), state: x.next_date < today ? "overdue" : x.next_date <= new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10) ? "soon" : "ok" })), kinds: COMPLIANCE_KINDS });
});
const schema = z.object({ kind: z.string(), title: z.string().min(2).max(160), supplier_id: z.string().nullable().optional(), last_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), interval_months: z.number().int().min(1).max(240), next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), document_id: z.string().nullable().optional(), notes: z.string().max(2000).nullable().optional() });
function nextFrom(last: string | null | undefined, months: number, fallback?: string) { if (fallback) return fallback; if (!last) throw new HttpError(400, "Geef de laatste datum of de volgende vervaldag"); const d = new Date(last + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); }
r.post("/:buildingId/compliance", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building"); const body = schema.parse(await c.req.json()); const id = uid();
  await c.env.DB.prepare("INSERT INTO compliance_items (id, building_id, kind, title, supplier_id, last_date, interval_months, next_date, document_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, b.id, body.kind, body.title, body.supplier_id ?? null, body.last_date ?? null, body.interval_months, nextFrom(body.last_date, body.interval_months, body.next_date), body.document_id ?? null, body.notes ?? null).run();
  return c.json({ id }, 201);
});
r.patch("/:buildingId/compliance/:id", requireBuilding("syndicus", "raad"), async (c) => {
  const b = c.get("building"); const body = schema.partial().parse(await c.req.json());
  const cur = await c.env.DB.prepare("SELECT * FROM compliance_items WHERE id = ? AND building_id = ?").bind(c.req.param("id"), b.id).first<any>();
  if (!cur) throw new HttpError(404, "Niet gevonden");
  const merged = { ...cur, ...body };
  // nieuwe keuring geregistreerd: volgende vervaldag herberekenen en herinnering resetten
  if (body.last_date && body.last_date !== cur.last_date && !body.next_date) { merged.next_date = nextFrom(body.last_date, merged.interval_months); merged.reminded_at = null; }
  await c.env.DB.prepare("UPDATE compliance_items SET kind = ?, title = ?, supplier_id = ?, last_date = ?, interval_months = ?, next_date = ?, document_id = ?, notes = ?, reminded_at = ? WHERE id = ?").bind(merged.kind, merged.title, merged.supplier_id ?? null, merged.last_date ?? null, merged.interval_months, merged.next_date, merged.document_id ?? null, merged.notes ?? null, merged.reminded_at ?? null, cur.id).run();
  await audit(c.env, b.id, c.get("user").id, "compliance.update", "compliance", cur.id);
  return c.json({ ok: true });
});
r.delete("/:buildingId/compliance/:id", requireBuilding("syndicus"), async (c) => { await c.env.DB.prepare("DELETE FROM compliance_items WHERE id = ? AND building_id = ?").bind(c.req.param("id"), c.get("building").id).run(); return c.json({ ok: true }); });

/** Cron: herinnering 60 dagen vóór de vervaldag en bij overschrijding (één keer, tot een nieuwe datum ingevoerd wordt). */
export async function complianceReminders(env: AppEnv["Bindings"]) {
  const soon = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare("SELECT * FROM compliance_items WHERE next_date <= ? AND reminded_at IS NULL").bind(soon).all()).results as any[];
  for (const x of rows) {
    const overdue = x.next_date < new Date().toISOString().slice(0, 10);
    await notifyBuilding(env, { buildingId: x.building_id, type: "compliance", title: `${overdue ? "Vervallen" : "Binnenkort te vernieuwen"}: ${x.title}`, body: `Vervaldag ${x.next_date}. Plan de keuring en registreer de nieuwe datum.`, link: `/b/${x.building_id}/documents?tab=compliance`, roles: ["syndicus", "raad"] });
    await env.DB.prepare("UPDATE compliance_items SET reminded_at = ? WHERE id = ?").bind(new Date().toISOString(), x.id).run();
  }
  return rows.length;
}
export default r;
