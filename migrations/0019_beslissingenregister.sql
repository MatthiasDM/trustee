-- Beslissingenregister (art. 3.93 §4) met termijnen: aanvechting binnen 4 maanden (art. 3.92 §3), bewoners zonder stemrecht
-- binnen 2 maanden na kennisgeving en uiterlijk 4 maanden (art. 3.93 §5), afbraak en heropbouw zonder eenparigheid via de rechter (art. 3.92 §1).
ALTER TABLE agenda_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'general'; -- general | works | statutes | demolition | other
ALTER TABLE agenda_items ADD COLUMN adopted INTEGER;                      -- 1 aangenomen, 0 verworpen, NULL onbekend (manueel genoteerd)
ALTER TABLE agenda_items ADD COLUMN challenge_status TEXT;                 -- NULL | pending | rejected | annulled | modified
ALTER TABLE agenda_items ADD COLUMN challenged_at TEXT;
ALTER TABLE agenda_items ADD COLUMN challenge_note TEXT;
ALTER TABLE agenda_items ADD COLUMN challenge_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE agenda_items ADD COLUMN court_status TEXT;                    -- afbraak/heropbouw: NULL | filed | approved | refused
ALTER TABLE agenda_items ADD COLUMN court_filed_at TEXT;
ALTER TABLE agenda_items ADD COLUMN court_ruling_at TEXT;
-- bestaande stemmingen: aangenomen afleiden uit de beslissingstekst
UPDATE agenda_items SET adopted = CASE WHEN decision LIKE 'Goedgekeurd%' OR decision LIKE 'Schriftelijk en eenparig aangenomen%' THEN 1 WHEN decision LIKE 'Verworpen%' THEN 0 END WHERE status = 'decided';
