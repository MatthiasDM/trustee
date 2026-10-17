-- Zetel van de VME (art. 3.86 §1), gegevens van de syndicus voor het uittreksel aan de ingang (art. 3.89 §2) en aanplakking.
ALTER TABLE buildings ADD COLUMN seat_address TEXT;      -- zetel in het gebouw; bij een groep van gebouwen: het gebouw uit de basisakte
ALTER TABLE buildings ADD COLUMN syndicus_info TEXT;     -- JSON: naam, rechtsvorm, beroep, woonplaats of zetel, KBO, telefoon, e-mail, raadpleegplaats
ALTER TABLE mandates ADD COLUMN extract_posted_at TEXT;
ALTER TABLE mandates ADD COLUMN extract_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
