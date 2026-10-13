-- Boekhouding VME: dubbel boekhouden volgens KB 12 juli 2012 (minimum genormaliseerd rekeningenstelsel)

CREATE TABLE fiscal_years (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,              -- bv. 2026
  start_date TEXT NOT NULL,         -- YYYY-MM-DD
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  closed_at TEXT,
  approved_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_fy_building ON fiscal_years(building_id, start_date);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  code TEXT NOT NULL,               -- KB-nummer, bv. 6121
  name TEXT NOT NULL,
  class INTEGER NOT NULL,           -- 1..7
  type TEXT NOT NULL,               -- asset | liability | equity | income | expense
  normal_side TEXT NOT NULL,        -- debit | credit
  fund TEXT,                        -- reserve | working | NULL (voor 550/551, 700/701, 4100/4101, 48901/48902)
  is_header INTEGER NOT NULL DEFAULT 0, -- groepsrekening, niet boekbaar
  is_system INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (building_id, code)
);
CREATE INDEX idx_accounts_building ON accounts(building_id, code);

-- Verdeelsleutels: hoe een kost over de kavels verdeeld wordt
CREATE TABLE cost_keys (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'shares', -- shares (aandelen) | custom (gewichten per kavel) | equal (gelijk per kavel)
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE cost_key_units (
  cost_key_id TEXT NOT NULL REFERENCES cost_keys(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (cost_key_id, unit_id)
);

-- Dagboek: gebalanceerde journaalposten, genummerd per boekjaar, onwijzigbaar na boeking
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
  number INTEGER NOT NULL,          -- volgnummer binnen het boekjaar
  date TEXT NOT NULL,               -- boekingsdatum YYYY-MM-DD
  period TEXT NOT NULL,             -- YYYY-MM
  description TEXT NOT NULL,
  template_code TEXT,               -- handeling waarmee geboekt werd
  counterparty TEXT,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL, -- verantwoordingsstuk
  status TEXT NOT NULL DEFAULT 'posted', -- scheduled | posted | reversed
  reverses_entry_id TEXT REFERENCES journal_entries(id),
  reversed_by_entry_id TEXT REFERENCES journal_entries(id),
  source TEXT NOT NULL DEFAULT 'manual', -- manual | template | depreciation | bank | call | closing
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_je_building ON journal_entries(building_id, date);
CREATE INDEX idx_je_fy ON journal_entries(fiscal_year_id, number);
CREATE INDEX idx_je_status ON journal_entries(building_id, status, date);

CREATE TABLE journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,       -- subgrootboek per kavel (vorderingen 410)
  cost_key_id TEXT REFERENCES cost_keys(id) ON DELETE SET NULL, -- verdeling van deze kost over kavels
  memo TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX idx_jl_account ON journal_lines(building_id, account_id);
CREATE INDEX idx_jl_unit ON journal_lines(building_id, unit_id);

-- Vaste activa met afschrijvingsplan (lineair); toekomstige afschrijvingen staan als 'scheduled' in het dagboek
CREATE TABLE fixed_assets (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_account_id TEXT NOT NULL REFERENCES accounts(id),       -- 2xx0 aanschaffingswaarde
  depreciation_account_id TEXT NOT NULL REFERENCES accounts(id),-- 2xx9 geboekte afschrijvingen
  expense_account_id TEXT NOT NULL REFERENCES accounts(id),     -- 6302
  cost REAL NOT NULL,
  acquired_at TEXT NOT NULL,
  years INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'yearly', -- yearly | monthly
  purchase_entry_id TEXT REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Oproepen van voorschotten (werk- of reservekapitaal) met gestructureerde mededeling per kavel
CREATE TABLE contribution_calls (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
  fund TEXT NOT NULL,               -- working | reserve
  date TEXT NOT NULL,
  due_date TEXT,
  description TEXT NOT NULL,
  total REAL NOT NULL,
  cost_key_id TEXT REFERENCES cost_keys(id),
  entry_id TEXT REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE contribution_call_lines (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES contribution_calls(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id),
  amount REAL NOT NULL,
  ogm TEXT NOT NULL                 -- gestructureerde mededeling +++xxx/xxxx/xxxxx+++
);
CREATE INDEX idx_ccl_call ON contribution_call_lines(call_id);
CREATE INDEX idx_ccl_ogm ON contribution_call_lines(ogm);

-- Begroting (art. 3.89 §5 16°): gewone en buitengewone kosten, goed te keuren door de AV
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved
  approved_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (building_id, fiscal_year_id)
);
CREATE TABLE budget_lines (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL DEFAULT 'ordinary', -- ordinary (gewone kosten, werkkapitaal) | extraordinary (buitengewone, reservekapitaal)
  amount REAL NOT NULL,
  cost_key_id TEXT REFERENCES cost_keys(id),
  memo TEXT
);
CREATE INDEX idx_budget_lines ON budget_lines(budget_id);

-- Bankrekeningen van de VME (werk- en reservekapitaal apart, art. 3.86 §3)
CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  iban TEXT,
  account_id TEXT NOT NULL REFERENCES accounts(id), -- 550 of 551
  fund TEXT NOT NULL,               -- working | reserve
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Geïmporteerde bankverrichtingen (CSV, CODA of manueel) te koppelen aan boekingen
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL,             -- positief = ontvangst, negatief = uitgave
  counterparty_name TEXT,
  counterparty_iban TEXT,
  communication TEXT,
  structured_ref TEXT,              -- OGM zonder opmaak (12 cijfers)
  external_ref TEXT,                -- referentie van de bank (dubbels vermijden)
  statement_no TEXT,
  source TEXT NOT NULL,             -- csv | coda | manual
  status TEXT NOT NULL DEFAULT 'unmatched', -- unmatched | matched | ignored
  entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (bank_account_id, external_ref)
);
CREATE INDEX idx_bt_building ON bank_transactions(building_id, status, date);

-- Opmerkingen van commissaris / raad bij boekingen (controle, geen bewerking)
CREATE TABLE ledger_comments (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'remark', -- remark | finding | approved
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ledger_comments ON ledger_comments(entry_id);
