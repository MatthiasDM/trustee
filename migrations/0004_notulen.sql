-- Algemene vergadering: volmachten, aanwezigheid/quorum, stemmen per agendapunt, notulen (art. 3.87 BW)
ALTER TABLE meetings ADD COLUMN is_second_call INTEGER NOT NULL DEFAULT 0; -- tweede bijeenroeping: geen quorum vereist
ALTER TABLE meetings ADD COLUMN chair_user_id TEXT REFERENCES users(id);
ALTER TABLE meetings ADD COLUMN secretary_user_id TEXT REFERENCES users(id);
ALTER TABLE meetings ADD COLUMN minutes_status TEXT NOT NULL DEFAULT 'none'; -- none | draft | final
ALTER TABLE meetings ADD COLUMN minutes_body TEXT;
ALTER TABLE meetings ADD COLUMN minutes_finalized_at TEXT;
ALTER TABLE meetings ADD COLUMN minutes_sent_at TEXT;

ALTER TABLE agenda_items ADD COLUMN votes_for REAL;       -- aandelen vóór
ALTER TABLE agenda_items ADD COLUMN votes_against REAL;
ALTER TABLE agenda_items ADD COLUMN votes_abstain REAL;
ALTER TABLE agenda_items ADD COLUMN voters_for INTEGER;   -- aantal kavels
ALTER TABLE agenda_items ADD COLUMN voters_against INTEGER;
ALTER TABLE agenda_items ADD COLUMN voters_abstain INTEGER;
ALTER TABLE agenda_items ADD COLUMN dissenters TEXT;      -- JSON: namen van wie tegenstemde (verplicht in de notulen)
ALTER TABLE agenda_items ADD COLUMN vote_detail TEXT;     -- JSON: [{unit_id, choice}]
ALTER TABLE agenda_items ADD COLUMN voted_at TEXT;
