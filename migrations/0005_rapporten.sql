-- Jaarrekening, individuele afrekening, verslag commissaris, betalingsherinneringen

-- Documenten die bij één kavel horen (individuele afrekening): enkel zichtbaar voor de eigenaars van die kavel en de organen
ALTER TABLE documents ADD COLUMN unit_id TEXT REFERENCES units(id) ON DELETE SET NULL;
CREATE INDEX idx_documents_unit ON documents(unit_id);

ALTER TABLE fiscal_years ADD COLUMN report_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;

CREATE TABLE commissioner_reports (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  scope TEXT,                 -- wat werd nagekeken (bankuittreksels, facturen, oproepen...)
  findings TEXT,              -- vaststellingen
  conclusion TEXT NOT NULL DEFAULT 'approve', -- approve | approve_with_remarks | reject
  recommendation TEXT,        -- advies aan de AV (kwijting of niet)
  status TEXT NOT NULL DEFAULT 'draft', -- draft | final
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  agenda_item_id TEXT REFERENCES agenda_items(id) ON DELETE SET NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cr_building ON commissioner_reports(building_id, fiscal_year_id);

CREATE TABLE payment_reminders (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,     -- 1 = herinnering, 2 = aanmaning (aangetekend aanbevolen), 3 = ingebrekestelling
  outstanding REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  sent_by TEXT REFERENCES users(id),
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reminders_unit ON payment_reminders(unit_id, sent_at);

-- instellingen betalingsopvolging per gebouw
ALTER TABLE buildings ADD COLUMN reminder_auto INTEGER NOT NULL DEFAULT 0;      -- automatische herinneringen door de cron
ALTER TABLE buildings ADD COLUMN reminder_days_1 INTEGER NOT NULL DEFAULT 7;    -- dagen na vervaldag: herinnering
ALTER TABLE buildings ADD COLUMN reminder_days_2 INTEGER NOT NULL DEFAULT 30;   -- dagen na vervaldag: aanmaning
ALTER TABLE buildings ADD COLUMN reminder_fee_2 REAL NOT NULL DEFAULT 0;        -- aanmaningskost (euro), enkel als het reglement dat voorziet
