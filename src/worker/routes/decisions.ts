import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { isBoard, requireAuth, requireBuilding } from "../lib/auth";
import { HttpError, now } from "../lib/util";
import { audit, notifyBuilding } from "../lib/notify";
import { DECISION_KINDS, decisionTerms } from "../lib/decisions";
import { votingUnits } from "../lib/voting";

/** Register van de beslissingen van de algemene vergadering (art. 3.93 §4), raadpleegbaar door iedere belanghebbende, met termijnen. */
export const decisions = new Hono<AppEnv>();
decisions.use("*", requireAuth);

async function loadRegister(env: Env, buildingId: string) {
  const rows = (await env.DB.prepare(`SELECT a.*, m.title AS meeting_title, m.starts_at AS meeting_starts_at, m.type AS meeting_type, m.minutes_sent_at, m.minutes_document_id, u.name AS submitted_by_name, p.title AS poll_title
     FROM agenda_items a LEFT JOIN meetings m ON m.id = a.meeting_id LEFT JOIN users u ON u.id = a.submitted_by LEFT JOIN polls p ON p.id = a.poll_id
     WHERE a.building_id = ? AND a.status = 'decided' AND (m.id IS NULL OR m.type IN ('av','bav'))
     ORDER BY COALESCE(m.starts_at, a.voted_at, a.updated_at) DESC, a.position`).bind(buildingId).all()).results as any[];
  const vunits = await votingUnits(env, buildingId);
  const ownerUnits = vunits.filter((u) => u.owners.length).map((u) => u.unit_id);
  return rows.map((r) => {
    const detail: { unit_id: string; choice: string }[] = r.vote_detail ? JSON.parse(r.vote_detail) : [];
    const unanimous = r.decision?.startsWith("Schriftelijk en eenparig") || (detail.length > 0 && ownerUnits.every((id) => detail.find((d) => d.unit_id === id)?.choice === "for"));
    const decidedOn = r.meeting_starts_at ?? r.voted_at ?? r.updated_at;
    const terms = decisionTerms({ decided_on: decidedOn, kind: r.kind ?? "general", adopted: r.adopted, unanimous, challenge_status: r.challenge_status, court_status: r.court_status, minutes_sent_at: r.minutes_sent_at });
    return { id: r.id, title: r.title, decision: r.decision, kind: r.kind ?? "general", kind_label: DECISION_KINDS[r.kind ?? "general"], adopted: r.adopted, required_majority: r.required_majority, unanimous, written: !r.meeting_id, meeting_id: r.meeting_id, meeting_title: r.meeting_title ?? (r.poll_title ? "Schriftelijke besluitvorming" : null), minutes_document_id: r.minutes_document_id, minutes_sent_at: r.minutes_sent_at, votes_for: r.votes_for, votes_against: r.votes_against, votes_abstain: r.votes_abstain, dissenters: r.dissenters ? JSON.parse(r.dissenters) : [], challenge_status: r.challenge_status, challenged_at: r.challenged_at, challenge_note: r.challenge_note, court_status: r.court_status, court_filed_at: r.court_filed_at, court_ruling_at: r.court_ruling_at, ...terms };
  });
}

decisions.get("/:buildingId/decisions", requireBuilding(), async (c) => c.json({ items: await loadRegister(c.env, c.get("building").id), kinds: DECISION_KINDS }));

/** Register als CSV (voor de notaris, het overdrachtsdossier of het archief). */
decisions.get("/:buildingId/decisions.csv", requireBuilding(), async (c) => {
  const items = await loadRegister(c.env, c.get("building").id);
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["datum;vergadering;onderwerp;soort;beslissing;aangenomen;tegenstemmers;status;aanvechtbaar tot", ...items.map((i) => [i.decided_on, q(i.meeting_title), q(i.title), q(i.kind_label), q(i.decision), i.adopted === 1 ? "ja" : i.adopted === 0 ? "nee" : "", q(i.dissenters.join(", ")), q(i.status_label), i.challenge_until].join(";"))];
  return new Response("﻿" + lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="beslissingenregister.csv"` } });
});

/** Opvolging registreren: soort beslissing, aanvechting bij de rechter, procedure afbraak/heropbouw (syndicus of raad). */
decisions.patch("/:buildingId/decisions/:itemId", requireBuilding(), async (c) => {
  const b = c.get("building"); const user = c.get("user");
  if (!isBoard(b.role) || b.role === "commissaris") throw new HttpError(403, "Enkel de syndicus of de raad houdt het register bij");
  const item = await c.env.DB.prepare("SELECT id, title, status FROM agenda_items WHERE id = ? AND building_id = ?").bind(c.req.param("itemId"), b.id).first<any>();
  if (!item || item.status !== "decided") throw new HttpError(404, "Beslissing niet gevonden");
  const body = z.object({
    kind: z.enum(["general", "works", "statutes", "demolition", "other"]).optional(),
    adopted: z.boolean().nullable().optional(),
    challenge_status: z.enum(["pending", "rejected", "annulled", "modified"]).nullable().optional(),
    challenged_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    challenge_note: z.string().max(2000).nullable().optional(),
    challenge_document_id: z.string().nullable().optional(),
    court_status: z.enum(["filed", "approved", "refused"]).nullable().optional(),
    court_filed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    court_ruling_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).parse(await c.req.json());
  const fields = Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? +v : v] as [string, unknown]);
  if (!fields.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE agenda_items SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...fields.map(([, v]) => v), now(), item.id).run();
  await audit(c.env, b.id, user.id, "decision.update", "agenda_item", item.id, body);
  if (body.challenge_status === "pending") await notifyBuilding(c.env, { buildingId: b.id, type: "decision", title: `Beslissing aangevochten: ${item.title}`, body: "Een vordering tot vernietiging of wijziging is ingesteld (art. 3.92 §3 BW). Zie het beslissingenregister.", link: `/b/${b.id}/decisions`, excludeUserId: user.id, email: false });
  if (body.challenge_status === "annulled") await notifyBuilding(c.env, { buildingId: b.id, type: "decision", title: `Beslissing vernietigd: ${item.title}`, body: "De rechter heeft deze beslissing vernietigd. Zie het beslissingenregister.", link: `/b/${b.id}/decisions`, excludeUserId: user.id });
  return c.json({ ok: true });
});

/** Cron: herinnering aan syndicus en raad 30 en 7 dagen voor de termijn om bij afbraak/heropbouw naar de vrederechter te gaan. */
export async function decisionReminders(env: Env) {
  const buildings = (await env.DB.prepare("SELECT DISTINCT building_id FROM agenda_items WHERE kind = 'demolition' AND status = 'decided' AND adopted = 1 AND court_status IS NULL").all<{ building_id: string }>()).results;
  let sent = 0; const today = new Date().toISOString().slice(0, 10);
  for (const { building_id } of buildings) for (const d of await loadRegister(env, building_id)) {
    if (!d.needs_court || d.court_status || !d.court_until) continue;
    const days = Math.round((new Date(d.court_until).getTime() - new Date(today).getTime()) / 86400_000);
    for (const n of [30, 7]) {
      if (days > n || days < 0) continue;
      const key = `decision:court:${d.id}:${n}`; if (await env.KV.get(key)) continue;
      await env.KV.put(key, "1", { expirationTtl: 200 * 86400 });
      await notifyBuilding(env, { buildingId: building_id, type: "decision", title: `Nog ${days} dagen: ${d.title}`, body: `Volledige afbraak en heropbouw zonder eenparigheid: de VME moet zich vóór ${d.court_until} tot de vrederechter richten (art. 3.92 §1 BW). De uitvoering is geschorst tot het vonnis.`, link: `/b/${building_id}/decisions`, roles: ["syndicus", "raad"] });
      sent++; break;
    }
  }
  return sent;
}
