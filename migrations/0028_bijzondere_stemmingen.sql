-- Stemming over lasten van bepaalde mede-eigenaars (art. 3.87 §6, lid 2) en nieuwe AV bij eenparigheid gemist door afwezigheid (art. 3.88 §4).
ALTER TABLE agenda_items ADD COLUMN charge_key_id TEXT REFERENCES cost_keys(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN unanimity_followup_of TEXT REFERENCES meetings(id) ON DELETE SET NULL;
