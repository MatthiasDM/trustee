-- Organen van de VME: agendapunten voor de AV, mandaten, opmerkingen van de commissaris op documenten

-- Agendapunten: ingediend door mede-eigenaars, geagendeerd op een AV, gekoppeld aan een stemming
CREATE TABLE agenda_items (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  required_majority TEXT NOT NULL DEFAULT 'simple', -- simple | two_thirds | four_fifths | unanimous | none
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | scheduled | decided | deferred | withdrawn
  position INTEGER NOT NULL DEFAULT 0,
  poll_id TEXT REFERENCES polls(id) ON DELETE SET NULL,
  decision TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agenda_building ON agenda_items(building_id, status);
CREATE INDEX idx_agenda_meeting ON agenda_items(meeting_id, position);

-- Mandaten: syndicus (max 3 jaar), raad van mede-eigendom en commissaris (jaarlijks), benoemd door de AV
CREATE TABLE mandates (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  organ TEXT NOT NULL, -- syndicus | raad | commissaris
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  holder_name TEXT, -- voor externen (bv. kantoor of accountant) zonder account
  function_title TEXT, -- bv. voorzitter raad
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  appointed_by_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_mandates_building ON mandates(building_id, organ, end_date);

-- Opmerkingen op documenten (commissaris, raad, syndicus): controle, geen bewerking
CREATE TABLE document_comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'remark', -- remark | finding | approved
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_doc_comments ON document_comments(document_id, created_at);

-- Periode waarin de gewone AV plaatsvindt (voor de 3-weken-regel): dag/maand start, duur in dagen
ALTER TABLE buildings ADD COLUMN av_period_start TEXT; -- MM-DD
ALTER TABLE buildings ADD COLUMN av_period_days INTEGER NOT NULL DEFAULT 15;
