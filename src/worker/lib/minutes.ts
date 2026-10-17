import type { Env } from "../env";
import { notifyBuilding } from "./notify";

/** Cron: de syndicus verwittigen wanneer de notulen van een AV 30 dagen na de vergadering nog niet bezorgd zijn (art. 3.87 §12 BW); één keer. */
export async function minutesLateReminders(env: Env) {
  const limit = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = (await env.DB.prepare("SELECT id, building_id, title, starts_at FROM meetings WHERE type IN ('av','bav') AND cancelled_at IS NULL AND starts_at < ? AND starts_at > ? AND minutes_status != 'final'").bind(limit, new Date(Date.now() - 120 * 86400_000).toISOString()).all<any>()).results;
  let n = 0;
  for (const m of rows) {
    const key = `minutes:late:${m.id}`; if (await env.KV.get(key)) continue;
    await env.KV.put(key, "1", { expirationTtl: 200 * 86400 });
    await notifyBuilding(env, { buildingId: m.building_id, type: "minutes", title: `Notulen te laat: ${m.title}`, body: "De notulen moeten binnen 30 dagen na de vergadering in het register staan en aan elke stemgerechtigde bezorgd zijn (art. 3.87 §12 BW). Maak ze nu definitief.", link: `/b/${m.building_id}/meetings`, roles: ["syndicus", "raad"] });
    n++;
  }
  return n;
}
