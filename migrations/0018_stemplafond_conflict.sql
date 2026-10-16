-- Stemplafond (art. 3.87 §8, lid 2) en belangenconflict (art. 3.87 §9) bij de stemming over een agendapunt.
ALTER TABLE agenda_items ADD COLUMN conflict_user_ids TEXT;  -- JSON: leden die niet mogen deelnemen (persoonlijk of bij volmacht)
ALTER TABLE agenda_items ADD COLUMN conflict_reason TEXT;
ALTER TABLE agenda_items ADD COLUMN vote_adjustments TEXT;   -- JSON: { capped: [...], excluded: [...] }
