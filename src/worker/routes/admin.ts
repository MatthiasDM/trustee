import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth, requireTwoFactor } from "../lib/auth";
import { restoreBuilding } from "../lib/backup";
import { audit } from "../lib/notify";
import { HttpError } from "../lib/util";

const admin = new Hono<AppEnv>();

/**
 * Platformbeheer: een gebouw terugzetten uit een back-up (uit R2 via `key`, of meegestuurd als `backup`).
 * Enkel als het gebouw niet meer bestaat; zie restoreBuilding. Meldt welke documenten niet meer in de bucket staan.
 */
admin.post("/restore", requireAuth, async (c) => {
  const user = c.get("user");
  if (!user.is_superadmin) throw new HttpError(403, "Enkel platformbeheer kan een back-up herstellen");
  requireTwoFactor(c);
  const body = z.object({ key: z.string().regex(/^backups\/[^/]+\/\d{4}-\d{2}-\d{2}\.json$/).optional(), backup: z.any().optional() }).parse(await c.req.json());
  let data = body.backup;
  if (body.key) {
    const obj = await c.env.DOCS.get(body.key);
    if (!obj) throw new HttpError(404, "Back-up niet gevonden");
    data = await obj.json();
  }
  if (!data) throw new HttpError(400, "Geef een back-up mee (key of backup)");
  const res = await restoreBuilding(c.env.DB, data);
  const missing: string[] = [];
  for (const d of (data.documents ?? []) as { name: string; r2_key: string; deleted_at?: string | null }[]) if (!d.deleted_at && !(await c.env.DOCS.head(d.r2_key))) missing.push(d.name);
  await audit(c.env, res.building_id, user.id, "building.restore", "building", res.building_id, { exported_at: data.exported_at, rows: res.rows, new_users: res.new_users, missing_documents: missing.length });
  return c.json({ ...res, missing_documents: missing });
});

export default admin;
