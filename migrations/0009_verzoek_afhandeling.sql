-- Afhandeling van een 1/5-verzoek: wanneer en door wie het ingewilligd of ingetrokken werd.
ALTER TABLE meeting_requests ADD COLUMN resolved_at TEXT;
ALTER TABLE meeting_requests ADD COLUMN resolved_by TEXT REFERENCES users(id);
ALTER TABLE meeting_requests ADD COLUMN resolution_note TEXT;
