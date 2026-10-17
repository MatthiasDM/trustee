-- Verplicht reservekapitaal (art. 3.86 §3 BW): uiterlijk 5 jaar na de voorlopige oplevering, jaarlijkse bijdrage minstens 5 % van de gewone
-- gemeenschappelijke lasten van het vorige boekjaar, tenzij de AV met 4/5 beslist het niet aan te leggen.
ALTER TABLE buildings ADD COLUMN provisional_acceptance_date TEXT;
ALTER TABLE buildings ADD COLUMN reserve_waiver_item_id TEXT REFERENCES agenda_items(id) ON DELETE SET NULL;
