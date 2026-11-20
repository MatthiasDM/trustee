import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BACKUP_EXCLUDED, BACKUP_SPECIAL, BACKUP_TABLES, BACKUP_VERSION, exportBuilding, restoreBuilding } from "../src/worker/lib/backup";

// node:sqlite via require: Vite kent deze ingebouwde module niet in elke versie.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Sqlite = InstanceType<typeof DatabaseSync>;

const B = "b-zeezicht";
const MIGRATIONS = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

/** Lege database met alle migraties, zoals `wrangler d1 migrations apply`. */
function migrated(): Sqlite {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of MIGRATIONS) db.exec(readFileSync(`migrations/${f}`, "utf8"));
  return db;
}

/** Het deel van de D1-API dat back-up en herstel gebruiken, bovenop SQLite. `batch` is één transactie, zoals bij D1. */
function d1(db: Sqlite) {
  const stmt = (sql: string, params: any[] = []): any => ({
    sql, params,
    bind: (...p: any[]) => stmt(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => { db.prepare(sql).run(...params); return { success: true }; },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: any[]) => {
      db.exec("BEGIN");
      try { for (const s of list) db.prepare(s.sql).run(...s.params); db.exec("COMMIT"); } catch (e) { try { db.exec("ROLLBACK"); } catch { /* al teruggedraaid */ } throw e; }
    },
  } as unknown as D1Database;
}
const env = (db: Sqlite) => ({ DB: d1(db) }) as any;

const tables = (db: Sqlite) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'").all() as { name: string }[]).map((r) => r.name);
const count = (db: Sqlite, sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as { c: number }).c;
/** Een export zoals hij in R2 of in het zip-archief staat: door JSON heen, zonder tijdstip. */
async function snapshot(db: Sqlite) { const { exported_at: _t, ...rest } = JSON.parse(JSON.stringify(await exportBuilding(env(db), B))); return rest as Record<string, any>; }

/**
 * Demo-seed, aangevuld met één rij in elke tabel die de seed leeg laat (leveranciers, keuringen, AV-verzoeken, …),
 * zodat de heen-en-terugtest elke tabel echt raakt. Verwijzingen wijzen naar bestaande rijen van hetzelfde gebouw.
 */
function seeded(): Sqlite {
  const db = migrated();
  db.exec(readFileSync("seed/seed.sql", "utf8"));
  const todo = BACKUP_TABLES.map((s) => s.table).filter((t) => count(db, `SELECT COUNT(*) AS c FROM ${t}`) === 0);
  for (let pass = 0; pass < 5 && todo.length; pass++) {
    for (const t of [...todo]) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; notnull: number }[];
      const fks = new Map((db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { from: string; table: string }[]).map((f) => [f.from, f.table]));
      const row: Record<string, unknown> = {};
      let wait = false;
      for (const c of cols) {
        const parent = fks.get(c.name);
        if (parent === t) row[c.name] = null;
        else if (parent) {
          const ref = db.prepare(`SELECT id FROM ${parent} LIMIT 1`).get() as { id: string } | undefined;
          if (!ref && c.notnull) wait = true; // ouder is zelf nog leeg: volgende ronde
          row[c.name] = ref?.id ?? null;
        } else row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 1 : c.name.endsWith("_at") || c.name.endsWith("date") ? "2026-01-15" : `test-${t}-${c.name}`;
      }
      if (wait) continue;
      db.prepare(`INSERT INTO ${t} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...(Object.values(row) as any[]));
      todo.splice(todo.indexOf(t), 1);
    }
  }
  expect(todo, "tabellen die de test niet kon vullen").toEqual([]);
  return db;
}

describe("back-up dekt het hele schema", () => {
  const db = migrated();
  const known = [...BACKUP_TABLES.map((s) => s.table), ...BACKUP_SPECIAL, ...Object.keys(BACKUP_EXCLUDED)];

  it("elke tabel uit de migraties zit in de back-up of is uitdrukkelijk uitgesloten", () => {
    expect(tables(db).filter((t) => !known.includes(t)), "nieuwe tabel: voeg ze toe aan BACKUP_TABLES (of met reden aan BACKUP_EXCLUDED) in src/worker/lib/backup.ts").toEqual([]);
    expect(known.filter((t) => !tables(db).includes(t)), "tabel bestaat niet meer").toEqual([]);
    expect(new Set(known).size).toBe(known.length);
  });
  it("elke tabel met een building_id zit in de back-up, behalve de persoonlijke inbox", () => {
    const perBuilding = tables(db).filter((t) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((c) => c.name === "building_id"));
    expect(perBuilding.filter((t) => !BACKUP_TABLES.some((s) => s.table === t))).toEqual(["notifications"]);
  });
  it("elke verwijzing naar een gebruiker neemt die gebruiker mee", () => {
    for (const s of BACKUP_TABLES) {
      const refs = (db.prepare(`PRAGMA foreign_key_list(${s.table})`).all() as { from: string; table: string }[]).filter((f) => f.table === "users").map((f) => f.from).sort();
      expect([...(s.users ?? [])].sort(), `users-kolommen van ${s.table}`).toEqual(refs);
    }
  });
});

describe("hersteltest: back-up terugzetten in een lege database", () => {
  it("geeft exact dezelfde gegevens terug, voor elke tabel", async () => {
    const source = seeded();
    const backup = await snapshot(source);
    expect(backup.version).toBe(BACKUP_VERSION);
    for (const t of [...BACKUP_TABLES.map((s) => s.table), ...BACKUP_SPECIAL]) expect(backup[t].length, `${t} is leeg in de back-up`).toBeGreaterThan(0);

    const target = migrated();
    const res = await restoreBuilding(d1(target), backup);
    expect(res.building_id).toBe(B);
    expect(res.org_restored).toBe(true);
    expect(res.new_users).toBe(backup.users.length);
    expect(await snapshot(target)).toEqual(backup);
    expect(target.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const s of BACKUP_TABLES) expect(count(target, `SELECT COUNT(*) AS c FROM ${s.table}`), s.table).toBe(backup[s.table].length);
  });

  it("neemt geen wachtwoorden of 2FA-geheimen mee; herstelde gebruikers kunnen pas aanmelden na een nieuw wachtwoord", async () => {
    const backup = await snapshot(seeded());
    for (const u of backup.users) expect(Object.keys(u).sort()).toEqual(["created_at", "email", "id", "locale", "name", "phone"]);
    const target = migrated();
    await restoreBuilding(d1(target), backup);
    expect(count(target, "SELECT COUNT(*) AS c FROM users WHERE password_hash != 'restored' OR is_superadmin != 0 OR totp_secret IS NOT NULL")).toBe(0);
  });

  it("bevat niets van een ander gebouw", async () => {
    const source = seeded();
    source.exec("INSERT INTO users (id, email, name, password_hash) VALUES ('u-ander', 'ander@demo.be', 'Ander', 'x')");
    source.exec("INSERT INTO buildings (id, org_id, name, address) SELECT 'b-ander', org_id, 'Ander gebouw', 'Elders 1' FROM buildings WHERE id = 'b-zeezicht'");
    source.exec("INSERT INTO building_members (building_id, user_id, role) VALUES ('b-ander', 'u-ander', 'eigenaar')");
    source.exec("INSERT INTO units (id, building_id, label) VALUES ('unit-ander', 'b-ander', 'A1')");
    source.exec("INSERT INTO unit_owners (unit_id, user_id) VALUES ('unit-ander', 'u-ander')");
    const dump = JSON.stringify(await snapshot(source));
    for (const leak of ["b-ander", "u-ander", "unit-ander", "ander@demo.be"]) expect(dump.includes(leak), leak).toBe(false);
  });

  it("overschrijft nooit: weigert als het gebouw nog bestaat, en zet dan niets terug", async () => {
    const source = seeded();
    const backup = await snapshot(source);
    const before = count(source, "SELECT COUNT(*) AS c FROM journal_lines");
    await expect(restoreBuilding(d1(source), backup)).rejects.toMatchObject({ status: 409 });
    expect(count(source, "SELECT COUNT(*) AS c FROM journal_lines")).toBe(before);
  });

  it("geeft verwijderde kantoormedewerkers geen toegang terug als het kantoor nog bestaat", async () => {
    const backup = await snapshot(seeded());
    const target = migrated();
    const org = backup.orgs[0];
    target.prepare(`INSERT INTO orgs (${Object.keys(org).join(", ")}) VALUES (${Object.keys(org).map(() => "?").join(", ")})`).run(...(Object.values(org) as any[]));
    const res = await restoreBuilding(d1(target), backup);
    expect(res.org_restored).toBe(false);
    expect(count(target, "SELECT COUNT(*) AS c FROM org_members")).toBe(0);
    expect(count(target, "SELECT COUNT(*) AS c FROM buildings")).toBe(1);
  });

  it("laat bestaande accounts ongemoeid en weigert een e-mailadres dat bij een ander account hoort", async () => {
    const backup = await snapshot(seeded());
    const u = backup.users[0];
    const same = migrated();
    same.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, 'Bestaand', 'pbkdf2$eigen')").run(u.id, u.email);
    expect((await restoreBuilding(d1(same), backup)).new_users).toBe(backup.users.length - 1);
    expect(same.prepare("SELECT name, password_hash FROM users WHERE id = ?").get(u.id)).toMatchObject({ name: "Bestaand", password_hash: "pbkdf2$eigen" });

    const clash = migrated();
    clash.prepare("INSERT INTO users (id, email, name, password_hash) VALUES ('u-iemand-anders', ?, 'Iemand', 'x')").run(u.email);
    await expect(restoreBuilding(d1(clash), backup)).rejects.toMatchObject({ status: 409 });
    expect(count(clash, "SELECT COUNT(*) AS c FROM buildings")).toBe(0);
  });

  it("is alles of niets: een back-up die naar ontbrekende gegevens verwijst zet niets terug", async () => {
    const backup = await snapshot(seeded());
    backup.journal_lines[0].account_id = "bestaat-niet";
    const target = migrated();
    await expect(restoreBuilding(d1(target), backup)).rejects.toMatchObject({ status: 409 });
    for (const t of ["buildings", "users", "journal_entries", "orgs"]) expect(count(target, `SELECT COUNT(*) AS c FROM ${t}`), t).toBe(0);
  });

  it("weigert oude of vreemde bestanden en kolomnamen die geen kolomnamen zijn", async () => {
    const backup = await snapshot(seeded());
    await expect(restoreBuilding(d1(migrated()), { ...backup, version: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(restoreBuilding(d1(migrated()), { format: "iets-anders" })).rejects.toMatchObject({ status: 400 });
    const evil = { ...backup, folders: [{ ...backup.folders[0], "name) VALUES (1); DROP TABLE users; --": 1 }] };
    await expect(restoreBuilding(d1(migrated()), evil)).rejects.toMatchObject({ status: 400 });
  });
});
