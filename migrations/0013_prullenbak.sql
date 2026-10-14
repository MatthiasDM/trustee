-- Prullenbak: documenten worden eerst zacht verwijderd en pas na 30 dagen definitief (herstelbaar door de syndicus).
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
ALTER TABLE documents ADD COLUMN deleted_by TEXT REFERENCES users(id);
CREATE INDEX idx_documents_deleted ON documents(building_id, deleted_at);
