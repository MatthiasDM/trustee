import type { Env } from "../env";
import { now } from "./util";

export const DEMO_TTL_MS = 24 * 3600_000;

/** Activiteit registreren (hoogstens om de 10 minuten een schrijfactie). */
export async function touchDemo(env: Env, buildingId: string, last: string | null) {
  if (last && Date.now() - new Date(last).getTime() < 10 * 60_000) return;
  await env.DB.prepare("UPDATE buildings SET demo_last_activity = ? WHERE id = ?").bind(now(), buildingId).run();
}

