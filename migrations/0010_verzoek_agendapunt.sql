-- Een ingewilligd 1/5-verzoek wordt als agendapunt op de bijeengeroepen vergadering gezet (art. 3.87 §2: de AV wordt over dat onderwerp bijeengeroepen).
ALTER TABLE meeting_requests ADD COLUMN agenda_item_id TEXT REFERENCES agenda_items(id) ON DELETE SET NULL;
