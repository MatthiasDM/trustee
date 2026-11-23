-- Volmacht aan een derde (art. 3.87 §7 BW: de lasthebber is "al dan niet lid van de algemene vergadering"; de volmacht vermeldt zijn naam).
-- Een derde heeft geen account: de volmachtgever vult de naam in. proxy_user_id blijft dan leeg.
ALTER TABLE meeting_rsvps ADD COLUMN proxy_name TEXT;
