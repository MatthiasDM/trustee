import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import type { AppEnv } from "./env";
import { HttpError } from "./lib/util";
import auth from "./routes/auth";
import buildings from "./routes/buildings";
import documents from "./routes/documents";
import posts from "./routes/posts";
import polls from "./routes/polls";
import meetings from "./routes/meetings";
import notifications from "./routes/notifications";
import agenda from "./routes/agenda";
import mandates, { ORGAN_RULES } from "./routes/mandates";
import ledger, { postDueScheduled } from "./routes/ledger";
import { runBackups } from "./lib/backup";
import { loadUser } from "./lib/auth";
import reports, { autoReminders } from "./routes/reports";
import orgs from "./routes/orgs";
import suppliers, { runDueRecurring } from "./routes/suppliers";
import compliance, { complianceReminders } from "./routes/compliance";
import { notifyBuilding } from "./lib/notify";

const app = new Hono<AppEnv>();
app.use("*", logger());
app.use("*", secureHeaders({ crossOriginEmbedderPolicy: false }));

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/auth", auth);
app.route("/api/buildings", buildings);
app.route("/api/buildings", documents);
app.route("/api/buildings", posts);
app.route("/api/buildings", polls);
app.route("/api/buildings", meetings);
app.route("/api/buildings", agenda);
app.route("/api/buildings", mandates);
app.route("/api/buildings", ledger);
app.route("/api/buildings", reports);
app.route("/api/buildings", suppliers);
app.route("/api/buildings", compliance);
app.route("/api/notifications", notifications);
app.route("/api/orgs", orgs);

app.post("/api/admin/run-cron", async (c) => { if (c.env.TEST_MODE !== "1") return c.json({ error: "Niet gevonden" }, 404); return c.json(await runCron(c.env, "test")); });
/** Testomgeving: wist de aanvaardingen van de aangemelde gebruiker, om de aanvaardingsdialoog bij een nieuwe versie te testen. */
app.post("/api/admin/reset-consents", async (c) => { if (c.env.TEST_MODE !== "1") return c.json({ error: "Niet gevonden" }, 404); const u = await loadUser(c); if (!u) return c.json({ error: "Niet aangemeld" }, 401); await c.env.DB.prepare("DELETE FROM consents WHERE user_id = ?").bind(u.id).run(); return c.json({ ok: true }); });

app.notFound((c) => c.json({ error: "Niet gevonden" }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  if (err instanceof ZodError) return c.json({ error: "Ongeldige invoer", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  console.error(err);
  return c.json({ error: "Interne fout" }, 500);
});

/** Achtergrondtaken (cron). In de testomgeving ook aanroepbaar via POST /api/admin/run-cron. */
export async function runCron(env: AppEnv["Bindings"], cron = "manual") {
      const started = Date.now();
      const nowIso = new Date().toISOString();
      const log: Record<string, unknown> = { started_at: nowIso, cron };
      try {
      // maandelijkse back-up op de 1e, in het eerste kwartier van de dag
      const d = new Date();
      if (d.getUTCDate() === 1 && d.getUTCHours() === 2 && d.getUTCMinutes() < 15) log.backups = await runBackups(env);
      const expired = await env.DB.prepare("SELECT id, building_id, title FROM polls WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at < ?").bind(nowIso).all<any>();
      for (const p of expired.results) {
        await env.DB.prepare("UPDATE polls SET status = 'closed' WHERE id = ?").bind(p.id).run();
        await notifyBuilding(env, { buildingId: p.building_id, type: "poll_closed", title: `Stemming afgesloten: ${p.title}`, body: "Bekijk de resultaten.", link: `/b/${p.building_id}/polls/${p.id}`, email: false });
      }
      // herinnering 24u vooraf (venster van 15 min zodat cron het één keer oppikt)
      const from = new Date(Date.now() + 24 * 3600_000).toISOString();
      const to = new Date(Date.now() + 24 * 3600_000 + 15 * 60_000).toISOString();
      const upcoming = await env.DB.prepare("SELECT id, building_id, title, starts_at, location FROM meetings WHERE starts_at >= ? AND starts_at < ?").bind(from, to).all<any>();
      for (const m of upcoming.results) {
        await notifyBuilding(env, { buildingId: m.building_id, type: "meeting_reminder", title: `Morgen: ${m.title}`, body: `${new Date(m.starts_at).toLocaleString("nl-BE", { timeZone: "Europe/Brussels" })}${m.location ? ` — ${m.location}` : ""}`, link: `/b/${m.building_id}/meetings` });
      }
      // mandaten die binnen 60 dagen aflopen: één herinnering aan syndicus en raad (venster van 15 min)
      const in60 = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
      const expiring = await env.DB.prepare("SELECT m.*, u.name AS user_name FROM mandates m LEFT JOIN users u ON u.id = m.user_id WHERE m.end_date = ?").bind(in60).all<any>();
      const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      if (minute < 15) for (const m of expiring.results) {
        await notifyBuilding(env, { buildingId: m.building_id, type: "mandate", title: `Mandaat loopt af over 60 dagen: ${ORGAN_RULES[m.organ as keyof typeof ORGAN_RULES].label}`, body: `${m.user_name ?? m.holder_name} — tot ${m.end_date}. Agendeer de herbenoeming op de algemene vergadering.`, link: `/b/${m.building_id}/members?tab=mandates`, roles: ["syndicus", "raad"] });
      }
      log.posted_scheduled = await postDueScheduled(env); // geplande afschrijvingen boeken
      const force = cron === "test"; // testomgeving: tijdsvensters negeren
      if (force || (new Date().getUTCHours() === 5 && new Date().getUTCMinutes() < 15)) { log.recurring = await runDueRecurring(env); log.compliance = await complianceReminders(env); }
      if (force || (new Date().getUTCHours() === 7 && new Date().getUTCMinutes() < 15)) log.reminders = await autoReminders(env); // dagelijks om 9u Belgische zomertijd
      await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso).run();
      await env.DB.prepare("DELETE FROM password_resets WHERE expires_at < ?").bind(nowIso).run();
      log.ok = true;
      } catch (e) { log.ok = false; log.error = String(e); console.error("cron failed", e); }
      log.duration_ms = Date.now() - started;
      await env.KV.put("cron:last", JSON.stringify(log));
      return log;
}

export default {
  fetch: app.fetch,
  /** Cron: sluit verlopen stemmingen, stuurt herinneringen voor vergaderingen (24u vooraf), ruimt sessies op. */
  async scheduled(event: ScheduledEvent, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env, event.cron));
  },
};
