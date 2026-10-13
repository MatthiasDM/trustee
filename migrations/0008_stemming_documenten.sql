-- Referenties van een stemming naar stukken in Documenten (offertes, verslagen, ...), in plaats van "zie xxx in documenten".
CREATE TABLE poll_documents (
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poll_id, document_id)
);
CREATE INDEX idx_poll_documents_doc ON poll_documents(document_id);
