-- Tweestapsverificatie (TOTP, RFC 6238) en herstelcodes (gehasht).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
ALTER TABLE users ADD COLUMN totp_recovery TEXT; -- JSON: lijst van SHA-256-hashes van nog ongebruikte herstelcodes
