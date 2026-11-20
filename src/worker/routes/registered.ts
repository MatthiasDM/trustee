import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, uid } from "../lib/util";
import { audit } from "../lib/notify";
import { MAJ } from "../lib/meeting";
import { Pdf, pdfOpts } from "../lib/pdf";
import { convenePreview, managedMeeting } from "./meetings";

/**
 * Aangetekende zendingen bij een vergadering (art. 3.87 §3 en §12 BW): de oproeping en de notulen gaan aangetekend naar wie niet
 * individueel instemde met een ander communicatiemiddel, of van wie het e-mailadres onbezorgbaar is.
 * Trustee maakt de brieven aan (één per geadresseerde) en houdt het register van de verzendingen bij: datum van afgifte,
 * barcode van het afgiftebewijs en eventueel het bewijs zelf. De afgifte bij de post of bij een aanbieder van elektronisch
 * aangetekende zendingen gebeurt door de syndicus.
 */
const registered = new Hono<AppEnv>();
registered.use("*", requireAuth);

const KINDS = ["convocation", "minutes"] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (c: Context<AppEnv>): Kind => z.enum(KINDS).default("convocation").parse(c.req.query("kind") ?? undefined);

/** Wie moet aangetekend bereikt worden, met adres en wat al verstuurd is. */
async function overview(c: Context<AppEnv>, m: any, kind: Kind) {
  const p = await convenePreview(c, m);
  const sent = (await c.env.DB.prepare("SELECT r.*, u.name AS created_by_name FROM registered_mail r LEFT JOIN users u ON u.id = r.created_by WHERE r.meeting_id = ? AND r.kind = ? ORDER BY r.sent_at, r.created_at").bind(m.id, kind).all<any>()).results;
  const needed = p.recipients.filter((r: any) => p.registered_needed.includes(r.user_id)).map((r: any) => ({
    user_id: r.user_id, name: r.name, units: r.units ?? null, postal_address: r.postal_address ?? null,
    reason: r.ecomm_consent_at ? "bounce" : "no_consent",
    sent: sent.filter((s) => s.user_id === r.user_id),
  }));
  return { kind, meeting: p.meeting, needed, open: needed.filter((n: any) => !n.sent.length).length, other: sent.filter((s) => !needed.some((n: any) => n.user_id === s.user_id)) };
}

registered.get("/:buildingId/meetings/:meetingId/registered", requireBuilding(), async (c) => {
  const m = await managedMeeting(c);
  return c.json(await overview(c, m, kindOf(c)));
});

/** Verzending registreren: datum van afgifte en barcode van het afgiftebewijs; het bewijs zelf kan als document gekoppeld worden. */
registered.post("/:buildingId/meetings/:meetingId/registered", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await managedMeeting(c);
  const body = z.object({
    kind: z.enum(KINDS).default("convocation"),
    user_ids: z.array(z.string()).min(1).max(500),
    sent_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.enum(["post", "electronic"]).default("post"),
    carrier: z.string().max(80).nullable().optional(),
    tracking: z.record(z.string(), z.string().max(80)).optional(), // barcode per geadresseerde
    proof_document_id: z.string().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  }).parse(await c.req.json());
  if (body.sent_at > new Date().toISOString().slice(0, 10)) throw new HttpError(400, "De datum van afgifte kan niet in de toekomst liggen");
  if (body.proof_document_id && !(await c.env.DB.prepare("SELECT 1 FROM documents WHERE id = ? AND building_id = ?").bind(body.proof_document_id, b.id).first())) throw new HttpError(400, "Document niet gevonden");
  const ids = [...new Set(body.user_ids)];
  const members = (await c.env.DB.prepare(`SELECT bm.user_id, u.name, bm.postal_address FROM building_members bm JOIN users u ON u.id = bm.user_id WHERE bm.building_id = ? AND bm.user_id IN (${ids.map(() => "?").join(",")})`).bind(b.id, ...ids).all<any>()).results;
  if (members.length !== ids.length) throw new HttpError(400, "Niet elke geadresseerde is lid van dit gebouw");
  const noAddress = members.filter((x) => !x.postal_address && body.method === "post");
  if (noAddress.length) throw new HttpError(400, `Geen postadres voor ${noAddress.map((x) => x.name).join(", ")}: vul het in onder Leden`);
  await c.env.DB.batch(members.map((x) => c.env.DB.prepare("INSERT INTO registered_mail (id, building_id, meeting_id, kind, user_id, recipient_name, address, method, carrier, tracking_number, sent_at, proof_document_id, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uid(), b.id, m.id, body.kind, x.user_id, x.name, x.postal_address ?? null, body.method, body.carrier ?? null, body.tracking?.[x.user_id]?.trim() || null, body.sent_at, body.proof_document_id ?? null, body.note ?? null, user.id)));
  await audit(c.env, b.id, user.id, "registered.sent", "meeting", m.id, { kind: body.kind, recipients: ids, sent_at: body.sent_at, method: body.method });
  // termijn van de oproeping: de aangetekende brief moet minstens 15 dagen vóór de vergadering afgegeven zijn (art. 3.87 §3)
  const days = Math.floor((new Date(m.starts_at).getTime() - new Date(`${body.sent_at}T00:00:00Z`).getTime()) / 86400_000);
  return c.json({ ok: true, recorded: members.length, ...(body.kind === "convocation" && m.type !== "raad" && days < 15 ? { warning: `Afgegeven ${days} dagen vóór de vergadering: de wet vraagt minstens 15 dagen (art. 3.87 §3 BW), behalve bij hoogdringendheid.` } : {}) });
});

/** Ontvangst of terugkeer noteren (bv. datum van het ontvangstbewijs). Een registratie wordt niet verwijderd: ze is bewijs. */
registered.patch("/:buildingId/meetings/:meetingId/registered/:id", requireBuilding(), async (c) => {
  const b = c.get("building");
  const m = await managedMeeting(c);
  const body = z.object({ delivered_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), tracking_number: z.string().max(80).nullable().optional(), note: z.string().max(500).nullable().optional(), proof_document_id: z.string().nullable().optional() }).parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT id FROM registered_mail WHERE id = ? AND meeting_id = ? AND building_id = ?").bind(c.req.param("id"), m.id, b.id).first();
  if (!row) throw new HttpError(404, "Zending niet gevonden");
  if (body.proof_document_id && !(await c.env.DB.prepare("SELECT 1 FROM documents WHERE id = ? AND building_id = ?").bind(body.proof_document_id, b.id).first())) throw new HttpError(400, "Document niet gevonden");
  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length) await c.env.DB.prepare(`UPDATE registered_mail SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...fields.map(([, v]) => v), c.req.param("id")).run();
  await audit(c.env, b.id, c.get("user").id, "registered.update", "meeting", m.id, body);
  return c.json({ ok: true });
});

/** De brieven als één PDF: één brief per geadresseerde die nog geen aangetekende zending kreeg (of ?all=1 voor iedereen op de lijst). */
registered.get("/:buildingId/meetings/:meetingId/registered/letters.pdf", requireBuilding(), async (c) => {
  const b = c.get("building");
  const m = await managedMeeting(c);
  const kind = kindOf(c);
  const o = await overview(c, m, kind);
  const list = o.needed.filter((n: any) => c.req.query("all") === "1" || !n.sent.length);
  if (!list.length) throw new HttpError(400, "Niemand op de lijst wacht nog op een aangetekende brief");
  if (kind === "minutes" && m.minutes_status !== "final") throw new HttpError(400, "Maak de notulen eerst definitief");
  const bld = (await c.env.DB.prepare("SELECT * FROM buildings WHERE id = ?").bind(b.id).first<any>())!;
  let info: any = {}; try { info = bld.syndicus_info ? JSON.parse(bld.syndicus_info) : {}; } catch { /* leeg */ }
  const items = (await c.env.DB.prepare("SELECT title, description, required_majority FROM agenda_items WHERE meeting_id = ? AND status IN ('scheduled','decided') ORDER BY position, created_at").bind(m.id).all<any>()).results;
  const when = new Date(m.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "full", timeStyle: "short" });
  const today = new Date().toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "long" });
  const seat = bld.seat_address ?? [bld.address, [bld.postal_code, bld.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const sender = [info.name, info.address].filter(Boolean).join(", ") || c.get("user").name;
  const pdf = await Pdf.create(`${b.name} - ${kind === "minutes" ? "notulen" : "oproeping"} ${m.title}`, pdfOpts(bld));
  list.forEach((r: any, i: number) => {
    if (i) pdf.pageBreak();
    pdf.text(`Vereniging van mede-eigenaars ${b.name}`, 10, { bold: true });
    pdf.text(`Zetel: ${seat}${bld.enterprise_number ? ` - KBO ${bld.enterprise_number}` : ""}`);
    pdf.text(`Syndicus: ${sender}`);
    pdf.space(18);
    pdf.text("AANGETEKEND", 10, { bold: true });
    pdf.text(r.name, 11);
    pdf.text(r.postal_address ?? "(postadres ontbreekt: vul het in onder Leden)", 11);
    pdf.space(18);
    pdf.text(today);
    pdf.space(8);
    if (kind === "convocation") {
      pdf.title(`Oproeping ${m.type === "bav" ? "buitengewone algemene vergadering" : m.type === "raad" ? "raad van mede-eigendom" : "algemene vergadering"}`);
      pdf.text(`Geachte ${r.name},`);
      pdf.text(`U wordt als mede-eigenaar${r.units ? ` (kavel ${r.units})` : ""} opgeroepen voor de vergadering "${m.title}"${m.is_second_call ? " (tweede vergadering)" : ""}.`);
      pdf.text(`Datum en uur: ${when}`, 10, { bold: true });
      pdf.text(`Plaats: ${m.location ?? "nog mee te delen"}`, 10, { bold: true });
      pdf.h2("Agenda");
      if (items.length) items.forEach((it, n) => { pdf.text(`${n + 1}. ${it.title}${MAJ[it.required_majority] && it.required_majority !== "none" ? ` (${MAJ[it.required_majority].label})` : ""}`, 9.5, { bold: true }); if (it.description) pdf.text(it.description); });
      if (m.agenda) pdf.text(m.agenda);
      if (!items.length && !m.agenda) pdf.text("(De agenda is nog leeg: agendeer eerst de punten.)", 9.5, { color: [0.7, 0.2, 0.1] });
      pdf.h2("Praktisch");
      pdf.text(`Raadpleging van de documenten over de geagendeerde punten: ${info.consult_place ? info.consult_place : `bij de syndicus${info.address ? `, ${info.address}` : ""}`}${`, en voor wie een account heeft op ${c.env.APP_URL}/b/${b.id}/meetings`}.`);
      pdf.text("Kan u niet aanwezig zijn, dan kan u zich laten vertegenwoordigen met een schriftelijke volmacht voor deze vergadering. De syndicus kan geen volmachtdrager zijn; niemand mag meer dan drie volmachten aannemen, tenzij het totaal van zijn eigen stemmen en die van zijn volmachtgevers niet meer dan 10 % bedraagt van alle stemmen van de kavels van de mede-eigendom (art. 3.87 §7 BW).");
    } else {
      pdf.title("Notulen van de algemene vergadering");
      pdf.text(`Geachte ${r.name},`);
      pdf.text(`Hierbij bezorgen wij u de notulen van de vergadering "${m.title}" van ${when} (art. 3.87 §12 BW). Een onregelmatige, bedrieglijke of onrechtmatige beslissing die u persoonlijk nadeel berokkent kan u binnen vier maanden na de vergadering voor de rechter aanvechten (art. 3.92 §3 BW).`);
      pdf.h2("Notulen");
      pdf.text(String(m.minutes_body ?? "").replace(/^#+\s*/gm, "").replace(/\*\*/g, ""));
    }
    pdf.space(14);
    pdf.text("Met de meeste hoogachting,");
    pdf.text(`${sender}`);
    pdf.text("syndicus");
  });
  await audit(c.env, b.id, c.get("user").id, "registered.letters", "meeting", m.id, { kind, recipients: list.map((r: any) => r.user_id) });
  return new Response(await pdf.bytes() as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="aangetekend-${kind === "minutes" ? "notulen" : "oproeping"}-${m.starts_at.slice(0, 10)}.pdf"` } });
});

export default registered;
