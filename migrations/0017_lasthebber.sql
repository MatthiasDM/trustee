-- Gesplitste eigendom (art. 3.87 §1, lid 2 BW): bij onverdeeldheid of opsplitsing (vruchtgebruik, erfpacht, opstal, gebruik/bewoning)
-- is het deelnamerecht geschorst tot de belanghebbenden één lasthebber aanwijzen en dat schriftelijk aan de syndicus meedelen.
ALTER TABLE unit_owners ADD COLUMN right_type TEXT NOT NULL DEFAULT 'vol'; -- vol | blote_eigendom | vruchtgebruik | erfpacht | opstal | gebruik_bewoning
ALTER TABLE units ADD COLUMN representative_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE units ADD COLUMN representative_set_at TEXT;
ALTER TABLE units ADD COLUMN representative_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
