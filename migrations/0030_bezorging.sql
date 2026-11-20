-- Bezorging: e-maillogboek met bezorgstatus (bounces via de webhook van Resend), postadres per lid en register van aangetekende zendingen.
ALTER TABLE users ADD COLUMN email_bounced_at TEXT;     -- laatste e-mail kwam niet aan (bounce of klacht); gewist bij een latere geslaagde bezorging
ALTER TABLE users ADD COLUMN email_bounce_reason TEXT;
ALTER TABLE building_members ADD COLUMN postal_address TEXT; -- woonplaats of zetel voor aangetekende zendingen (art. 3.87 §3 BW)

CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  kind TEXT NOT NULL,               -- type melding: meeting, minutes, invite, …
  provider_id TEXT,                 -- id van het bericht bij Resend
  status TEXT NOT NULL,             -- sent | delivered | delayed | bounced | complained | failed | logged (geen verzending: ontwikkelomgeving)
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX idx_email_log_building ON email_log(building_id, created_at);
CREATE INDEX idx_email_log_provider ON email_log(provider_id);

CREATE TABLE registered_mail (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'convocation', -- convocation | minutes | other
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  address TEXT,
  method TEXT NOT NULL DEFAULT 'post',      -- post | electronic (gekwalificeerde elektronische aangetekende zending)
  carrier TEXT,
  tracking_number TEXT,                     -- barcode of referentie van het afgiftebewijs
  sent_at TEXT NOT NULL,                    -- datum van afgifte
  delivered_at TEXT,
  proof_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_registered_mail ON registered_mail(building_id, meeting_id);
