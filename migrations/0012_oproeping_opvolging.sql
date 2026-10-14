-- Mens in de lus: oproeping is een aparte, gelogde handeling; annuleren i.p.v. verwijderen; automatische opvolging maakt voorstellen.
ALTER TABLE meetings ADD COLUMN convened_at TEXT;
ALTER TABLE meetings ADD COLUMN convened_by TEXT REFERENCES users(id);
ALTER TABLE meetings ADD COLUMN cancelled_at TEXT;
ALTER TABLE meetings ADD COLUMN cancelled_by TEXT REFERENCES users(id);
ALTER TABLE meetings ADD COLUMN cancel_reason TEXT;
-- akkoord van het lid met elektronische oproeping en kennisgeving (anders aangetekend): 'app' = zelf aangevinkt, 'written' = schriftelijk, door syndicus geregistreerd
ALTER TABLE building_members ADD COLUMN ecomm_consent_at TEXT;
ALTER TABLE building_members ADD COLUMN ecomm_consent_via TEXT;
-- voorstellen van de automatische betalingsopvolging; de syndicus verstuurt of wijst af
CREATE TABLE reminder_proposals (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  outstanding REAL NOT NULL,
  days_overdue INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | sent | dismissed
  reminder_id TEXT REFERENCES payment_reminders(id) ON DELETE SET NULL,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reminder_proposals ON reminder_proposals(building_id, status);
