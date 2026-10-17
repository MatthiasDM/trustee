/**
 * Deelverenigingen (art. 3.84 BW): de spiegelkavels in een deelvereniging volgen de eigenaars, rechten en lasthebber van de kavel
 * in de hoofdvereniging. Elke wijziging van eigenaars in de hoofdvereniging wordt hiermee doorgezet; nieuwe eigenaars worden lid.
 */
export async function syncChildUnits(db: D1Database, parentUnitId: string) {
  const children = (await db.prepare("SELECT id, building_id FROM units WHERE parent_unit_id = ?").bind(parentUnitId).all<{ id: string; building_id: string }>()).results;
  if (!children.length) return 0;
  const parent = await db.prepare("SELECT representative_user_id, representative_set_at, representative_document_id FROM units WHERE id = ?").bind(parentUnitId).first<any>();
  const owners = (await db.prepare("SELECT user_id, share_pct, right_type FROM unit_owners WHERE unit_id = ?").bind(parentUnitId).all<{ user_id: string; share_pct: number; right_type: string }>()).results;
  for (const ch of children) {
    const before = (await db.prepare("SELECT user_id FROM unit_owners WHERE unit_id = ?").bind(ch.id).all<{ user_id: string }>()).results.map((r) => r.user_id);
    await db.batch([
      db.prepare("DELETE FROM unit_owners WHERE unit_id = ?").bind(ch.id),
      ...owners.map((o) => db.prepare("INSERT INTO unit_owners (unit_id, user_id, share_pct, right_type) VALUES (?,?,?,?)").bind(ch.id, o.user_id, o.share_pct, o.right_type)),
      db.prepare("UPDATE units SET representative_user_id = ?, representative_set_at = ?, representative_document_id = NULL WHERE id = ?").bind(parent?.representative_user_id ?? null, parent?.representative_set_at ?? null, ch.id),
      ...owners.map((o) => db.prepare("INSERT OR IGNORE INTO building_members (building_id, user_id, role) VALUES (?, ?, 'eigenaar')").bind(ch.building_id, o.user_id)),
    ]);
    // wie geen kavel meer heeft in de deelvereniging en enkel eigenaar was, verlaat ze
    for (const u of before.filter((x) => !owners.some((o) => o.user_id === x))) {
      const still = await db.prepare("SELECT 1 FROM unit_owners uo JOIN units un ON un.id = uo.unit_id WHERE un.building_id = ? AND uo.user_id = ?").bind(ch.building_id, u).first();
      if (!still) await db.prepare("DELETE FROM building_members WHERE building_id = ? AND user_id = ? AND role = 'eigenaar'").bind(ch.building_id, u).run();
    }
  }
  return children.length;
}
