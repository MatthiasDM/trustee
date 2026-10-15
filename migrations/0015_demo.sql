-- Demo-modus: wegwerpgebouwen met eigen gebruikers, verwijderd na 24 u zonder activiteit.
ALTER TABLE buildings ADD COLUMN demo_group TEXT;
ALTER TABLE buildings ADD COLUMN demo_last_activity TEXT;
ALTER TABLE users ADD COLUMN demo_group TEXT;
CREATE INDEX idx_buildings_demo ON buildings(demo_group, demo_last_activity);
CREATE INDEX idx_users_demo ON users(demo_group);
