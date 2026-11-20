-- Ondertekening van de notulen (art. 3.87 §10 BW) en deelname aan de algemene vergadering op afstand (art. 3.87 §1 BW).

-- Eén handtekening per persoon per vergadering, gebonden aan de inhoud (SHA-256 van de tekst): wijzigt de tekst, dan vervallen ze.
CREATE TABLE minutes_signatures (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  capacity TEXT NOT NULL,            -- chair | secretary | chair_secretary | owner
  method TEXT NOT NULL,              -- electronic (zelf in Trustee) | paper (handgeschreven, geregistreerd door de syndicus)
  signed_at TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  recorded_by TEXT REFERENCES users(id),
  PRIMARY KEY (meeting_id, user_id)
);
ALTER TABLE meetings ADD COLUMN minutes_hash TEXT;             -- SHA-256 van de definitieve tekst
ALTER TABLE meetings ADD COLUMN minutes_unsigned_reason TEXT;  -- waarom definitief zonder handtekening van voorzitter of secretaris

-- Deelname op afstand: enkel als de oproeping erin voorziet.
ALTER TABLE meetings ADD COLUMN remote_allowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN remote_url TEXT;               -- link naar de videovergadering
ALTER TABLE meetings ADD COLUMN remote_info TEXT;              -- praktische afspraken (aanmelden, identificatie, stemmen)

-- Stemronde voor wie op afstand deelneemt: de voorzitter opent ze per agendapunt; de stem telt mee bij het vastleggen van de beslissing.
ALTER TABLE agenda_items ADD COLUMN ballot_opened_at TEXT;
ALTER TABLE agenda_items ADD COLUMN ballot_closed_at TEXT;
CREATE TABLE remote_ballots (
  item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  choice TEXT NOT NULL,              -- for | against | abstain
  cast_at TEXT NOT NULL,
  PRIMARY KEY (item_id, unit_id)
);
