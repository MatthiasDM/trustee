-- Bewoners zonder stemrecht (art. 3.89 §5, 6° BW): datum van de vergadering meedelen en aanplakken; schriftelijke vragen of opmerkingen
-- over de gemeenschappelijke delen worden aan de vergadering meegedeeld.
CREATE TABLE meeting_questions (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_meeting_questions ON meeting_questions(meeting_id);
ALTER TABLE meetings ADD COLUMN resident_notice_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
