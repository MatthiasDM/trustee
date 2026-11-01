-- Publieke demo: gestarte demo's per dag tellen (adres enkel gehasht met de datum, na 24 u verwijderd)
CREATE TABLE demo_starts (ip_hash TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX idx_demo_starts_at ON demo_starts(at);
