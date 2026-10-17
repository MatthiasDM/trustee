-- Kabels, leidingen en bijbehorende faciliteiten in de gemeenschappelijke delen (art. 3.82 §2 BW).
CREATE TABLE infrastructure_works (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,  -- mede-eigenaar; NULL bij een nutsoperator
  operator_name TEXT,                                         -- erkende nutsoperator (door de syndicus geregistreerd)
  sender_address TEXT NOT NULL,
  domain TEXT NOT NULL,                                       -- energie | water | telecommunicatie
  description TEXT NOT NULL,
  justification TEXT NOT NULL,                                -- rechtvaardiging van de optimalisatie
  planned_start TEXT,
  received_at TEXT,                                           -- ontvangst van de aangetekende zending door de syndicus
  objection_ground TEXT,                                      -- existing | damage | no_optimisation
  objection_note TEXT,
  objected_at TEXT,
  objected_by TEXT REFERENCES users(id),
  own_works_at TEXT,                                          -- VME/mede-eigenaars voeren de optimalisatie zelf uit (start binnen 6 maanden)
  progress TEXT NOT NULL DEFAULT 'announced',                 -- announced | started | done | withdrawn
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_infrastructure_works ON infrastructure_works(building_id);
