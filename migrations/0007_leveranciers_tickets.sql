-- Leveranciers, periodieke boekingen, verzoek tot AV (1/5), schriftelijke besluitvorming, keuringsattesten, tickets

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,                  -- lift, verwarming, schoonmaak, verzekering, ...
  iban TEXT,
  vat TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  default_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  default_cost_key_id TEXT REFERENCES cost_keys(id) ON DELETE SET NULL,
  contract_until TEXT,            -- einddatum contract (herinnering)
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_suppliers_building ON suppliers(building_id, name);
CREATE INDEX idx_suppliers_iban ON suppliers(iban);

CREATE TABLE recurring_entries (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_code TEXT NOT NULL,    -- handeling
  params TEXT NOT NULL,           -- JSON met de velden van de handeling (zonder datum)
  frequency TEXT NOT NULL,        -- monthly | quarterly | halfyearly | yearly
  next_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_run TEXT,
  last_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_recurring_due ON recurring_entries(active, next_date);

-- Verzoek tot bijeenroeping van een AV door mede-eigenaars met minstens 1/5 van de aandelen (art. 3.87 §2)
CREATE TABLE meeting_requests (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'collecting', -- collecting | threshold_reached | fulfilled | cancelled
  threshold_reached_at TEXT,
  deadline TEXT,                  -- 30 dagen na het bereiken van 1/5
  fulfilled_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE meeting_request_signatures (
  request_id TEXT NOT NULL REFERENCES meeting_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (request_id, user_id)
);

-- Schriftelijke besluitvorming (art. 3.87 §11): eenparigheid van alle mede-eigenaars, buiten de AV om
ALTER TABLE polls ADD COLUMN written INTEGER NOT NULL DEFAULT 0;
ALTER TABLE polls ADD COLUMN outcome TEXT;           -- adopted | rejected | expired

-- Keuringsattesten en periodieke controles met vervaldatum
CREATE TABLE compliance_items (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,             -- lift | brand | elektriciteit | verwarming | gas | epc | asbest | legionella | verzekering | overig
  title TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  last_date TEXT,
  interval_months INTEGER NOT NULL DEFAULT 12,
  next_date TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  notes TEXT,
  reminded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_compliance_due ON compliance_items(building_id, next_date);

-- Meldingen als tickets
ALTER TABLE posts ADD COLUMN supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN due_date TEXT;
ALTER TABLE posts ADD COLUMN cost_estimate REAL;
ALTER TABLE posts ADD COLUMN location TEXT;          -- bv. lift, garage, verdieping 2
ALTER TABLE posts ADD COLUMN resolved_at TEXT;
