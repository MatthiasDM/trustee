-- Bezorging van de notulen (art. 3.87 §12 BW): binnen 30 dagen aan elke stemgerechtigde; wie ze niet ontving, meldt dat schriftelijk.
CREATE TABLE minutes_receipts (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TEXT,
  opened_at TEXT,
  reported_missing_at TEXT,
  PRIMARY KEY (meeting_id, user_id)
);
