-- Trustee: syndicus / VME platform — initieel schema
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  locale TEXT NOT NULL DEFAULT 'nl',
  is_superadmin INTEGER NOT NULL DEFAULT 0,
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Tenant: een syndicuskantoor (of zelfbeheer)
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter', -- starter | pro | enterprise
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin', -- owner | admin | staff
  PRIMARY KEY (org_id, user_id)
);

-- VME / gebouw
CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  postal_code TEXT,
  enterprise_number TEXT, -- ondernemingsnummer VME
  total_shares INTEGER NOT NULL DEFAULT 1000, -- aandelen / duizendsten
  fiscal_year_start TEXT, -- MM-DD
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_buildings_org ON buildings(org_id);

CREATE TABLE building_members (
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- syndicus | raad | eigenaar | huurder | commissaris
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_push INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (building_id, user_id)
);
CREATE INDEX idx_bm_user ON building_members(user_id);

-- Kavels (appartementen, garages, bergingen)
CREATE TABLE units (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'appartement', -- appartement | garage | berging | handel | ander
  floor TEXT,
  shares INTEGER NOT NULL DEFAULT 0, -- quotiteit
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_units_building ON units(building_id);

CREATE TABLE unit_owners (
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_pct REAL NOT NULL DEFAULT 100, -- percentage van de kavel in eigendom
  PRIMARY KEY (unit_id, user_id)
);
CREATE INDEX idx_unit_owners_user ON unit_owners(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_invites_building ON invites(building_id);

-- Documenten
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'all', -- all | raad | syndicus
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_folders_building ON folders(building_id, parent_id);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'overig', -- statuten | reglement | verslag_av | boekhouding | offerte | factuur | verzekering | contract | overig
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'all', -- all | raad | syndicus | owners_only
  uploaded_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_documents_building ON documents(building_id, folder_id);

-- Vragen, meldingen, mededelingen
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'question', -- question | announcement | incident
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | answered | in_progress | resolved | closed
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  pinned INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'all', -- all | syndicus (privé aan syndicus)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_posts_building ON posts(building_id, created_at DESC);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  is_answer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_comments_post ON comments(post_id);

CREATE TABLE post_attachments (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, document_id)
);

-- Polls / stemmingen
CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  weighted INTEGER NOT NULL DEFAULT 0, -- 1 = gewogen volgens quotiteiten
  anonymous INTEGER NOT NULL DEFAULT 0,
  multiple INTEGER NOT NULL DEFAULT 0,
  owners_only INTEGER NOT NULL DEFAULT 1,
  required_majority TEXT NOT NULL DEFAULT 'simple', -- simple | two_thirds | four_fifths | unanimous | none
  opens_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- draft | open | closed
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_polls_building ON polls(building_id, created_at DESC);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_poll_options_poll ON poll_options(poll_id);

CREATE TABLE poll_votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (poll_id, option_id, user_id)
);
CREATE INDEX idx_poll_votes_poll ON poll_votes(poll_id);

-- Algemene vergaderingen
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'av', -- av (algemene vergadering) | bav (bijzondere) | raad
  starts_at TEXT NOT NULL,
  location TEXT,
  agenda TEXT,
  minutes_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_meetings_building ON meetings(building_id, starts_at);

CREATE TABLE meeting_rsvps (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- attending | proxy | absent
  proxy_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (meeting_id, user_id)
);

-- Notificaties
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_building ON audit_log(building_id, created_at DESC);

-- Wachtwoord reset
CREATE TABLE password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
