// Genereert migrations/seed.sql met demo-accounts (wachtwoord: wachtwoord123)
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function hash(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210000 }, key, 256);
  return `pbkdf2$210000$${b64u(salt)}$${b64u(bits)}`;
}
const h = await hash("wachtwoord123");
const sql = `
-- Demo-data. Alle accounts: wachtwoord "wachtwoord123"
INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES
 ('u-syndicus','syndicus@demo.be','Sofie Vermeulen','${h}'),
 ('u-jan','jan@demo.be','Jan Peeters','${h}'),
 ('u-marie','marie@demo.be','Marie Claes','${h}'),
 ('u-ahmed','ahmed@demo.be','Ahmed El Idrissi','${h}'),
 ('u-lotte','lotte@demo.be','Lotte De Smet','${h}');
INSERT OR IGNORE INTO orgs (id, name, slug, plan) VALUES ('org-demo','Syndicus Vermeulen bv','syndicus-vermeulen','pro');
INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES ('org-demo','u-syndicus','owner');
INSERT OR IGNORE INTO buildings (id, org_id, name, address, city, postal_code, enterprise_number, total_shares) VALUES
 ('b-zeezicht','org-demo','Residentie Zeezicht','Zeedijk 12','Oostende','8400','0712.345.678',1000);
INSERT OR IGNORE INTO building_members (building_id, user_id, role) VALUES
 ('b-zeezicht','u-syndicus','syndicus'),('b-zeezicht','u-jan','raad'),('b-zeezicht','u-marie','eigenaar'),('b-zeezicht','u-ahmed','eigenaar'),('b-zeezicht','u-lotte','huurder');
INSERT OR IGNORE INTO units (id, building_id, label, type, floor, shares) VALUES
 ('un-a1','b-zeezicht','A1','appartement','0',250),('un-a2','b-zeezicht','A2','appartement','1',300),('un-a3','b-zeezicht','A3','appartement','2',350),('un-g1','b-zeezicht','G1','garage','-1',50),('un-g2','b-zeezicht','G2','garage','-1',50);
INSERT OR IGNORE INTO unit_owners (unit_id, user_id, share_pct) VALUES ('un-a1','u-jan',100),('un-a2','u-marie',100),('un-a3','u-ahmed',100),('un-g1','u-jan',100),('un-g2','u-marie',100);
INSERT OR IGNORE INTO folders (id, building_id, name) VALUES
 ('f-statuten','b-zeezicht','Statuten & basisakte'),('f-verslagen','b-zeezicht','Verslagen algemene vergadering'),('f-boekhouding','b-zeezicht','Boekhouding & afrekeningen'),('f-offertes','b-zeezicht','Offertes & facturen');
INSERT OR IGNORE INTO posts (id, building_id, author_id, type, title, body, status, pinned) VALUES
 ('p-1','b-zeezicht','u-syndicus','announcement','Welkom op het nieuwe platform','Beste mede-eigenaars, vanaf nu vinden jullie hier alle documenten, mededelingen en stemmingen van Residentie Zeezicht. Zet push-meldingen aan via Instellingen.','open',1),
 ('p-2','b-zeezicht','u-marie','question','Wanneer wordt de gevel gereinigd?','Op de vorige AV werd gezegd dat de gevelreiniging in het voorjaar zou gebeuren. Is daar al een datum voor?','open',0),
 ('p-3','b-zeezicht','u-ahmed','incident','Lift blokkeert af en toe op verdieping 2','De lift blijft sinds vorige week regelmatig hangen tussen verdieping 1 en 2. Graag een technieker laten langskomen.','in_progress',0);
UPDATE posts SET priority='high' WHERE id='p-3';
INSERT OR IGNORE INTO comments (id, post_id, author_id, body, is_answer) VALUES
 ('c-1','p-2','u-syndicus','De gevelreiniging is ingepland voor de week van 18 mei. De firma plaatst de stelling op maandag.',1),
 ('c-2','p-3','u-syndicus','Kone is verwittigd; technieker komt donderdag langs.',0);
INSERT OR IGNORE INTO polls (id, building_id, created_by, title, description, weighted, anonymous, multiple, owners_only, required_majority, status) VALUES
 ('poll-1','b-zeezicht','u-syndicus','Goedkeuring offerte dakrenovatie (€ 48.500)','Offerte van Dakwerken Devos voor volledige vernieuwing van de dakbedekking incl. isolatie. Zie map Offertes & facturen.',1,0,0,1,'two_thirds','open');
INSERT OR IGNORE INTO poll_options (id, poll_id, label, position) VALUES ('po-1','poll-1','Ja, goedkeuren',0),('po-2','poll-1','Nee',1),('po-3','poll-1','Onthouding',2);
INSERT OR IGNORE INTO poll_votes (id, poll_id, option_id, user_id, weight) VALUES ('pv-1','poll-1','po-1','u-jan',300);
UPDATE buildings SET av_period_start='03-01', av_period_days=31 WHERE id='b-zeezicht';
INSERT OR IGNORE INTO mandates (id, building_id, organ, user_id, holder_name, function_title, start_date, end_date) VALUES
 ('md-1','b-zeezicht','syndicus','u-syndicus',NULL,NULL,date('now','-1 year'),date('now','+2 years')),
 ('md-2','b-zeezicht','raad','u-jan',NULL,'Voorzitter',date('now','-6 months'),date('now','+6 months')),
 ('md-3','b-zeezicht','commissaris',NULL,'Accountantskantoor Dewulf',NULL,date('now','-10 months'),date('now','+45 days'));
INSERT OR IGNORE INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status, position, poll_id) VALUES
 ('ag-1','b-zeezicht','m-1','u-syndicus','Goedkeuring verslag vorige AV',NULL,'simple','scheduled',1,NULL),
 ('ag-2','b-zeezicht','m-1','u-syndicus','Jaarrekening 2025 en kwijting syndicus','Verslag van de commissaris van de rekeningen wordt toegevoegd.','simple','scheduled',2,NULL),
 ('ag-3','b-zeezicht','m-1','u-syndicus','Dakrenovatie: goedkeuring offerte Dakwerken Devos','Zie stemming.','two_thirds','scheduled',3,'poll-1'),
 ('ag-4','b-zeezicht',NULL,'u-marie','Fietsenstalling uitbreiden','Er is plaats tekort voor fietsen. Voorstel om de berging naast de inkom om te vormen.','two_thirds','proposed',0,NULL);
INSERT OR IGNORE INTO meetings (id, building_id, title, type, starts_at, location, agenda, created_by) VALUES
 ('m-1','b-zeezicht','Jaarlijkse algemene vergadering 2026','av',strftime('%Y-%m-%dT18:30:00.000Z','now','+21 days'),'Inkomhal, gelijkvloers','1. Goedkeuring verslag vorige AV\n2. Jaarrekening 2025 en kwijting syndicus\n3. Begroting 2026\n4. Dakrenovatie: toelichting en stemming\n5. Varia','u-syndicus');
`;
writeFileSync(new URL("../seed/seed.sql", import.meta.url), sql);
console.log("seed.sql geschreven");
