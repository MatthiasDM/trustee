-- Noodbeheer: voorlopig syndicus (art. 3.89 §6-§8) en bijeenroeping door mede-eigenaars (art. 3.87 §2, lid 3 en 4).
ALTER TABLE mandates ADD COLUMN basis TEXT;        -- voorlopig_syndicus: av (§7) | rechter (§8) | delegatie (§6)
ALTER TABLE mandates ADD COLUMN scope TEXT;        -- welomschreven doeleinden / beperkingen
ALTER TABLE mandates ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE SET NULL; -- vonnis, notulen of akte
ALTER TABLE meetings ADD COLUMN convened_by_owners INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN legal_basis TEXT;
ALTER TABLE meetings ADD COLUMN request_id TEXT REFERENCES meeting_requests(id) ON DELETE SET NULL;
ALTER TABLE meeting_requests ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general'; -- general | appoint_syndicus
