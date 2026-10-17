-- Deelverenigingen (art. 3.84 en 3.86 §2 BW): eigen VME voor de particulier gemeenschappelijke delen van een gebouw of onderdeel,
-- gekoppeld aan de hoofdvereniging; spiegelkavels volgen de eigenaars van de kavels in de hoofdvereniging.
ALTER TABLE buildings ADD COLUMN parent_building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE;
ALTER TABLE buildings ADD COLUMN sub_scope TEXT;             -- particulier gemeenschappelijke delen waarvoor de deelvereniging bevoegd is
ALTER TABLE buildings ADD COLUMN sub_basis TEXT;             -- basisakte | av
ALTER TABLE buildings ADD COLUMN sub_basis_item_id TEXT REFERENCES agenda_items(id) ON DELETE SET NULL;
ALTER TABLE buildings ADD COLUMN sub_basis_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE units ADD COLUMN parent_unit_id TEXT REFERENCES units(id) ON DELETE CASCADE;
CREATE INDEX idx_units_parent ON units(parent_unit_id);
CREATE INDEX idx_buildings_parent ON buildings(parent_building_id);
