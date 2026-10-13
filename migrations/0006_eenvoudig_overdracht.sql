-- Vereenvoudigde boekhouding (< 20 kavels) en overdrachtsdossier bij verkoop (art. 3.94 BW)
ALTER TABLE buildings ADD COLUMN ledger_mode TEXT NOT NULL DEFAULT 'auto';   -- auto | simple | double
ALTER TABLE buildings ADD COLUMN legal_proceedings TEXT;                     -- lopende gerechtelijke procedures (voor het overdrachtsdossier)
ALTER TABLE buildings ADD COLUMN insurance_info TEXT;                        -- polis(sen) brand/BA, voor informatie bij verkoop
