-- Afrekening bij overdracht van een kavel (art. 3.94 §5 en 3.95 BW).
CREATE TABLE unit_transfers (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  transfer_date TEXT NOT NULL,     -- dag waarop de koper de gemeenschappelijke delen kan gebruiken
  act_date TEXT,                   -- datum authentieke akte (mededeling notaris, art. 3.94 §3)
  notary TEXT,
  seller_ids TEXT NOT NULL,        -- JSON
  seller_names TEXT NOT NULL,
  buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  buyer_name TEXT,
  buyer_email TEXT,
  invite_id TEXT REFERENCES invites(id) ON DELETE SET NULL,
  fiscal_year_id TEXT REFERENCES fiscal_years(id) ON DELETE SET NULL,
  working_called REAL NOT NULL DEFAULT 0,
  working_refund REAL NOT NULL DEFAULT 0,
  reserve_paid REAL NOT NULL DEFAULT 0,
  arrears_working REAL NOT NULL DEFAULT 0,
  arrears_reserve REAL NOT NULL DEFAULT 0,
  fees REAL NOT NULL DEFAULT 0,
  entry_ids TEXT,                  -- JSON
  call_id TEXT REFERENCES contribution_calls(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_unit_transfers ON unit_transfers(building_id, unit_id);
