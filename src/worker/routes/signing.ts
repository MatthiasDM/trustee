import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { canManageMeeting } from "../lib/governance";
import { attendance } from "../lib/meeting";
import { bodyHash, eligibleSigners, missingOfficers, signaturesOf } from "../lib/minutes";
import { managedMeeting } from "./meetings";

/**
 * Ondertekening van de notulen (art. 3.87 §10 BW) en deelname aan de algemene vergadering vanop afstand (art. 3.87 §1 BW).
 * Zie docs/wetgeving.md: de wet regelt het elektronisch tekenen en het stemmen vanop afstand niet; dit is de invulling van Trustee.
 */
export const signing = new Hono<AppEnv>();
signing.use("*", requireAuth);

async function meetingOf(c: Context<AppEnv>) {
  const m = await c.env.DB.prepare("SELECT * FROM meetings WHERE id = ? AND building_id = ?").bind(c.req.param("meetingId"), c.get("building").id).first<any>();
  if (!m) throw new HttpError(404, "Vergadering niet gevonden");
  return m;
}

// ---------- Ondertekening ----------

/** Stand van de ondertekening. Wie mag tekenen (of de vergadering beheert) krijgt ook de tekst, om ze na te lezen. */
signing.get("/:buildingId/meetings/:meetingId/minutes/signatures", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await meetingOf(c);
  const manage = canManageMeeting(b, user.id, m);
  if (m.minutes_status === "none" || !m.minutes_body) return c.json({ status: m.minutes_status, signers: [], can_sign: false, can_manage: manage, missing: [] });
  const hash = m.minutes_hash ?? await bodyHash(m.minutes_body);
  const signers = await eligibleSigners(c.env, b.id, m);
  const sigs = (await signaturesOf(c.env, m.id)).filter((s) => s.body_hash === hash);
  const me = signers.find((s) => s.user_id === user.id);
  if (!manage && !me) throw new HttpError(403, "Enkel de voorzitter, de secretaris en de aanwezige mede-eigenaars of hun lasthebbers tekenen de notulen");
  const rows = signers.map((s) => { const sig = sigs.find((x) => x.user_id === s.user_id); return { ...s, signed_at: sig?.signed_at ?? null, method: sig?.method ?? null }; });
  return c.json({ status: m.minutes_status, hash, body: m.minutes_body, signers: rows, my_capacity: me?.capacity ?? null, signed_by_me: !!sigs.find((s) => s.user_id === user.id), can_sign: m.minutes_status === "draft" && !!me && !sigs.some((s) => s.user_id === user.id), can_manage: manage, missing: missingOfficers(m, sigs, hash), unsigned_reason: m.minutes_unsigned_reason ?? null });
});

/** Zelf tekenen. De hash van de gelezen tekst gaat mee: is de tekst intussen gewijzigd, dan wordt de handtekening geweigerd. */
signing.post("/:buildingId/meetings/:meetingId/minutes/sign", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { hash } = z.object({ hash: z.string().length(64) }).parse(await c.req.json());
  const m = await meetingOf(c);
  if (m.minutes_status !== "draft" || !m.minutes_body) throw new HttpError(400, m.minutes_status === "final" ? "De notulen zijn al definitief" : "Er is nog geen ontwerp van de notulen");
  if (hash !== await bodyHash(m.minutes_body)) throw new HttpError(409, "De tekst is gewijzigd sinds je hem las. Lees de notulen opnieuw en teken dan.");
  const me = (await eligibleSigners(c.env, b.id, m)).find((s) => s.user_id === user.id);
  if (!me) throw new HttpError(403, "Enkel de voorzitter, de secretaris en de aanwezige mede-eigenaars of hun lasthebbers tekenen de notulen (art. 3.87 §10 BW)");
  await c.env.DB.prepare("INSERT INTO minutes_signatures (meeting_id, user_id, capacity, method, signed_at, body_hash) VALUES (?,?,?,'electronic',?,?) ON CONFLICT(meeting_id, user_id) DO UPDATE SET capacity = excluded.capacity, method = 'electronic', signed_at = excluded.signed_at, body_hash = excluded.body_hash, recorded_by = NULL")
    .bind(m.id, user.id, me.capacity, now(), hash).run();
  await audit(c.env, b.id, user.id, "minutes.sign", "meeting", m.id, { capacity: me.capacity, hash, remote: me.remote });
  return c.json({ ok: true, capacity: me.capacity });
});

/** Handgeschreven handtekeningen registreren (wie de vergadering beheert): wie tekende op het papieren exemplaar. */
signing.post("/:buildingId/meetings/:meetingId/minutes/signatures/paper", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { user_ids } = z.object({ user_ids: z.array(z.string()).min(1).max(500) }).parse(await c.req.json());
  const m = await managedMeeting(c);
  if (m.minutes_status !== "draft" || !m.minutes_body) throw new HttpError(400, m.minutes_status === "final" ? "De notulen zijn al definitief" : "Er is nog geen ontwerp van de notulen");
  const hash = await bodyHash(m.minutes_body);
  const signers = await eligibleSigners(c.env, b.id, m);
  const unknown = user_ids.filter((id) => !signers.some((s) => s.user_id === id));
  if (unknown.length) throw new HttpError(400, "Enkel de voorzitter, de secretaris en wie op de aanwezigheidslijst staat kan getekend hebben");
  const at = now();
  await c.env.DB.batch(user_ids.map((id) => c.env.DB.prepare("INSERT INTO minutes_signatures (meeting_id, user_id, capacity, method, signed_at, body_hash, recorded_by) VALUES (?,?,?,'paper',?,?,?) ON CONFLICT(meeting_id, user_id) DO UPDATE SET capacity = excluded.capacity, method = 'paper', signed_at = excluded.signed_at, body_hash = excluded.body_hash, recorded_by = excluded.recorded_by")
    .bind(m.id, id, signers.find((s) => s.user_id === id)!.capacity, at, hash, user.id)));
  await audit(c.env, b.id, user.id, "minutes.sign_paper", "meeting", m.id, { user_ids, hash });
  return c.json({ ok: true, recorded: user_ids.length });
});

/** Een handtekening intrekken zolang de notulen niet definitief zijn: de eigen handtekening, of (beheer) een verkeerd geregistreerde papieren. */
signing.delete("/:buildingId/meetings/:meetingId/minutes/signatures/:userId", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user"); const target = c.req.param("userId");
  const m = await meetingOf(c);
  if (m.minutes_status === "final") throw new HttpError(400, "De notulen zijn al definitief");
  const sig = await c.env.DB.prepare("SELECT method FROM minutes_signatures WHERE meeting_id = ? AND user_id = ?").bind(m.id, target).first<{ method: string }>();
  if (!sig) throw new HttpError(404, "Geen handtekening gevonden");
  const own = target === user.id;
  if (!own && !(canManageMeeting(b, user.id, m) && sig.method === "paper")) throw new HttpError(403, "Je kan enkel je eigen handtekening intrekken; een beheerder enkel een geregistreerde papieren handtekening");
  await c.env.DB.prepare("DELETE FROM minutes_signatures WHERE meeting_id = ? AND user_id = ?").bind(m.id, target).run();
  await audit(c.env, b.id, user.id, "minutes.unsign", "meeting", m.id, { user_id: target, method: sig.method });
  return c.json({ ok: true });
});

/** Uitnodiging om te tekenen aan wie nog niet tekende. */
signing.post("/:buildingId/meetings/:meetingId/minutes/signatures/request", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await managedMeeting(c);
  if (m.minutes_status !== "draft" || !m.minutes_body) throw new HttpError(400, "Er is geen ontwerp om te tekenen");
  const hash = await bodyHash(m.minutes_body);
  const sigs = (await signaturesOf(c.env, m.id)).filter((s) => s.body_hash === hash);
  const open = (await eligibleSigners(c.env, b.id, m)).filter((s) => !sigs.some((x) => x.user_id === s.user_id) && s.user_id !== user.id);
  if (open.length) await notifyBuilding(c.env, { buildingId: b.id, type: "minutes", title: `Notulen ter ondertekening: ${m.title}`, body: "Lees de notulen na en teken ze. De voorzitter, de secretaris en de aanwezige mede-eigenaars of hun lasthebbers tekenen (art. 3.87 §10 BW).", link: `/b/${b.id}/meetings?sign=${m.id}`, userIds: open.map((s) => s.user_id), email: true });
  await audit(c.env, b.id, user.id, "minutes.sign_request", "meeting", m.id, { asked: open.map((s) => s.user_id) });
  return c.json({ ok: true, asked: open.length });
});

// ---------- Deelname vanop afstand ----------

/** De kavels waarvoor iemand vanop afstand de stem uitbrengt: zijn eigen kavels en de kavels waarvoor hij een volmacht draagt. */
async function remoteUnits(c: Context<AppEnv>, meetingId: string, userId: string) {
  const att = await attendance(c.env, c.get("building").id, meetingId);
  return att.rows.filter((r) => r.present && r.remote && r.acting_id === userId);
}

/** Wat een deelnemer vanop afstand nodig heeft: de link, de afspraken en de open stemrondes. De link is enkel zichtbaar voor wie zich vanop afstand aanmeldde of de vergadering beheert. */
signing.get("/:buildingId/meetings/:meetingId/remote", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const m = await meetingOf(c);
  const manage = canManageMeeting(b, user.id, m);
  const mine = m.remote_allowed ? await remoteUnits(c, m.id, user.id) : [];
  const joined = mine.length > 0;
  const items = (await c.env.DB.prepare("SELECT id, title, required_majority, ballot_opened_at, ballot_closed_at, voted_at, conflict_user_ids FROM agenda_items WHERE meeting_id = ? AND ballot_opened_at IS NOT NULL ORDER BY position, created_at").bind(m.id).all<any>()).results;
  const ballots = items.length ? (await c.env.DB.prepare(`SELECT item_id, unit_id, user_id, choice, cast_at FROM remote_ballots WHERE item_id IN (${items.map(() => "?").join(",")})`).bind(...items.map((i) => i.id)).all<any>()).results : [];
  return c.json({
    allowed: !!m.remote_allowed, joined, can_manage: manage, info: m.remote_info ?? null, url: joined || manage ? m.remote_url ?? null : null,
    units: mine.map((r) => ({ unit_id: r.unit_id, label: r.label, shares: r.shares, proxy: r.status === "proxy" })),
    items: items.map((i) => {
      const conflict: string[] = i.conflict_user_ids ? JSON.parse(i.conflict_user_ids) : [];
      const own = ballots.filter((x) => x.item_id === i.id && x.user_id === user.id);
      return { id: i.id, title: i.title, required_majority: i.required_majority, open: !i.ballot_closed_at && !i.voted_at, my_choice: own[0]?.choice ?? null, excluded: conflict.includes(user.id),
        ...(manage ? { cast: ballots.filter((x) => x.item_id === i.id).map((x) => ({ unit_id: x.unit_id, choice: x.choice })) } : {}) };
    }),
  });
});

/** De voorzitter opent of sluit de stemronde vanop afstand voor één agendapunt. */
signing.post("/:buildingId/meetings/:meetingId/agenda/:itemId/ballot/:action{open|close}", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user"); const action = c.req.param("action");
  const m = await managedMeeting(c);
  if (!m.remote_allowed) throw new HttpError(400, "Deze vergadering voorziet geen deelname vanop afstand; dat kan enkel als de bijeenroeping erin voorziet (art. 3.87 §1 BW)");
  const item = await c.env.DB.prepare("SELECT id, voted_at FROM agenda_items WHERE id = ? AND meeting_id = ? AND building_id = ?").bind(c.req.param("itemId"), m.id, b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden op deze vergadering");
  if (item.voted_at) throw new HttpError(400, "De beslissing over dit punt is al vastgelegd");
  if (action === "open") await c.env.DB.prepare("UPDATE agenda_items SET ballot_opened_at = ?, ballot_closed_at = NULL WHERE id = ?").bind(now(), item.id).run();
  else await c.env.DB.prepare("UPDATE agenda_items SET ballot_closed_at = ? WHERE id = ? AND ballot_opened_at IS NOT NULL").bind(now(), item.id).run();
  await audit(c.env, b.id, user.id, `agenda.ballot_${action}`, "agenda_item", item.id);
  return c.json({ ok: true });
});

/** Stem vanop afstand: één keuze voor alle kavels waarvoor de deelnemer stemt. Wijzigen kan tot de ronde sluit. */
signing.put("/:buildingId/meetings/:meetingId/agenda/:itemId/ballot", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  const { choice } = z.object({ choice: z.enum(["for", "against", "abstain"]) }).parse(await c.req.json());
  const m = await meetingOf(c);
  if (!m.remote_allowed) throw new HttpError(400, "Deze vergadering voorziet geen deelname vanop afstand (art. 3.87 §1 BW)");
  const item = await c.env.DB.prepare("SELECT id, ballot_opened_at, ballot_closed_at, voted_at, conflict_user_ids FROM agenda_items WHERE id = ? AND meeting_id = ? AND building_id = ?").bind(c.req.param("itemId"), m.id, b.id).first<any>();
  if (!item) throw new HttpError(404, "Agendapunt niet gevonden op deze vergadering");
  if (!item.ballot_opened_at || item.ballot_closed_at || item.voted_at) throw new HttpError(400, "De stemronde voor dit punt is niet open");
  if ((item.conflict_user_ids ? JSON.parse(item.conflict_user_ids) as string[] : []).includes(user.id)) throw new HttpError(403, "Je neemt niet deel aan de stemming over dit punt wegens belangenconflict (art. 3.87 §9 BW)");
  const units = await remoteUnits(c, m.id, user.id);
  if (!units.length) throw new HttpError(403, "Enkel wie zich voor deze vergadering vanop afstand aanmeldde, stemt hier. Ter plaatse registreert de voorzitter je stem.");
  const at = now();
  await c.env.DB.batch(units.map((u) => c.env.DB.prepare("INSERT INTO remote_ballots (item_id, unit_id, user_id, choice, cast_at) VALUES (?,?,?,?,?) ON CONFLICT(item_id, unit_id) DO UPDATE SET user_id = excluded.user_id, choice = excluded.choice, cast_at = excluded.cast_at").bind(item.id, u.unit_id, user.id, choice, at)));
  await audit(c.env, b.id, user.id, "agenda.ballot_cast", "agenda_item", item.id, { units: units.map((u) => u.label), choice });
  return c.json({ ok: true, units: units.map((u) => u.label), choice });
});
