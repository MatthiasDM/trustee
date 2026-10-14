-- Aanvaarding van voorwaarden en privacyverklaring, per gebruiker en per versie (bewijs).
CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document TEXT NOT NULL,           -- terms | privacy
  version TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_consents_user ON consents(user_id, document, version);
