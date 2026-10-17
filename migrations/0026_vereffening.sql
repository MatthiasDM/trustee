-- Ontbinding en vereffening van de VME (art. 3.97 en 3.98 BW).
ALTER TABLE buildings ADD COLUMN dissolution_status TEXT;            -- NULL | in_liquidation | closed
ALTER TABLE buildings ADD COLUMN dissolution_ground TEXT;            -- end_of_indivision | av_unanimous | court
ALTER TABLE buildings ADD COLUMN dissolved_at TEXT;
ALTER TABLE buildings ADD COLUMN dissolution_item_id TEXT REFERENCES agenda_items(id) ON DELETE SET NULL;
ALTER TABLE buildings ADD COLUMN dissolution_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE buildings ADD COLUMN liquidator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE buildings ADD COLUMN liquidator_name TEXT;
ALTER TABLE buildings ADD COLUMN archive_place TEXT;                 -- waar de boeken en bescheiden minstens 5 jaar bewaard worden
ALTER TABLE buildings ADD COLUMN consignment_note TEXT;              -- consignatie van niet-uitgekeerde gelden en waarden
ALTER TABLE buildings ADD COLUMN closing_act_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE buildings ADD COLUMN closed_at TEXT;
ALTER TABLE buildings ADD COLUMN transcribed_at TEXT;                -- overschrijving van de slotakte: start van de verjaring van 5 jaar
