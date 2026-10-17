
-- Demo-data. Alle accounts: wachtwoord "wachtwoord123"
INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES
 ('u-syndicus','syndicus@demo.be','Sofie Vermeulen','pbkdf2$100000$d5M0kVHtC4sL4T_3UydE6g$DFO3tQ319LQsk6jz4sSuT8oKHTcLmEn29TUhXLH3gRQ'),
 ('u-jan','jan@demo.be','Jan Peeters','pbkdf2$100000$d5M0kVHtC4sL4T_3UydE6g$DFO3tQ319LQsk6jz4sSuT8oKHTcLmEn29TUhXLH3gRQ'),
 ('u-marie','marie@demo.be','Marie Claes','pbkdf2$100000$d5M0kVHtC4sL4T_3UydE6g$DFO3tQ319LQsk6jz4sSuT8oKHTcLmEn29TUhXLH3gRQ'),
 ('u-ahmed','ahmed@demo.be','Ahmed El Idrissi','pbkdf2$100000$d5M0kVHtC4sL4T_3UydE6g$DFO3tQ319LQsk6jz4sSuT8oKHTcLmEn29TUhXLH3gRQ'),
 ('u-lotte','lotte@demo.be','Lotte De Smet','pbkdf2$100000$d5M0kVHtC4sL4T_3UydE6g$DFO3tQ319LQsk6jz4sSuT8oKHTcLmEn29TUhXLH3gRQ');
INSERT OR IGNORE INTO consents (id, user_id, document, version) VALUES
('c-u-syndicus-terms','u-syndicus','terms','2026-10-14'),('c-u-syndicus-privacy','u-syndicus','privacy','2026-10-14'),('c-u-jan-terms','u-jan','terms','2026-10-14'),('c-u-jan-privacy','u-jan','privacy','2026-10-14'),('c-u-marie-terms','u-marie','terms','2026-10-14'),('c-u-marie-privacy','u-marie','privacy','2026-10-14'),('c-u-ahmed-terms','u-ahmed','terms','2026-10-14'),('c-u-ahmed-privacy','u-ahmed','privacy','2026-10-14'),('c-u-lotte-terms','u-lotte','terms','2026-10-14'),('c-u-lotte-privacy','u-lotte','privacy','2026-10-14');
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
INSERT OR IGNORE INTO meetings (id, building_id, title, type, starts_at, location, agenda, created_by) VALUES
 ('m-1','b-zeezicht','Jaarlijkse algemene vergadering 2026','av',strftime('%Y-%m-%dT18:30:00.000Z','now','+21 days'),'Inkomhal, gelijkvloers','1. Goedkeuring verslag vorige AV
2. Jaarrekening 2025 en kwijting syndicus
3. Begroting 2026
4. Dakrenovatie: toelichting en stemming
5. Varia','u-syndicus');
INSERT OR IGNORE INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status, position, poll_id) VALUES
 ('ag-1','b-zeezicht','m-1','u-syndicus','Goedkeuring verslag vorige AV',NULL,'simple','scheduled',1,NULL),
 ('ag-2','b-zeezicht','m-1','u-syndicus','Jaarrekening 2025 en kwijting syndicus','Verslag van de commissaris van de rekeningen wordt toegevoegd.','simple','scheduled',2,NULL),
 ('ag-3','b-zeezicht','m-1','u-syndicus','Dakrenovatie: goedkeuring offerte Dakwerken Devos','Zie stemming.','two_thirds','scheduled',3,'poll-1'),
 ('ag-4','b-zeezicht',NULL,'u-marie','Fietsenstalling uitbreiden','Er is plaats tekort voor fietsen. Voorstel om de berging naast de inkom om te vormen.','two_thirds','proposed',0,NULL);

-- Boekhouding demo (boekjaar 2026)
INSERT OR IGNORE INTO accounts (id, building_id, code, name, class, type, normal_side, fund, is_header, is_system) VALUES
('acc-17','b-zeezicht','17','Schulden op meer dan één jaar',1,'liability','credit',NULL,1,1),
('acc-173','b-zeezicht','173','Kredietinstellingen (leningen > 1 jaar)',1,'liability','credit',NULL,0,1),
('acc-174','b-zeezicht','174','Overige leningen',1,'liability','credit',NULL,0,1),
('acc-179','b-zeezicht','179','Overige schulden > 1 jaar',1,'liability','credit',NULL,0,1),
('acc-2','b-zeezicht','2','Vaste activa',2,'asset','debit',NULL,1,1),
('acc-2110','b-zeezicht','2110','Immateriële vaste activa: aanschaffingswaarde',2,'asset','debit',NULL,0,1),
('acc-2119','b-zeezicht','2119','Immateriële vaste activa: geboekte afschrijvingen',2,'asset','debit',NULL,0,1),
('acc-2300','b-zeezicht','2300','Installaties, machines en uitrusting: aanschaffingswaarde',2,'asset','debit',NULL,0,1),
('acc-2309','b-zeezicht','2309','Installaties, machines en uitrusting: geboekte afschrijvingen',2,'asset','debit',NULL,0,1),
('acc-2400','b-zeezicht','2400','Meubilair en rollend materieel: aanschaffingswaarde',2,'asset','debit',NULL,0,1),
('acc-2409','b-zeezicht','2409','Meubilair en rollend materieel: geboekte afschrijvingen',2,'asset','debit',NULL,0,1),
('acc-2600','b-zeezicht','2600','Andere materiële vaste activa: aanschaffingswaarde',2,'asset','debit',NULL,0,1),
('acc-2609','b-zeezicht','2609','Andere materiële vaste activa: geboekte afschrijvingen',2,'asset','debit',NULL,0,1),
('acc-280','b-zeezicht','280','Betaalde waarborgen',2,'asset','debit',NULL,0,1),
('acc-41','b-zeezicht','41','Vorderingen',4,'asset','debit',NULL,1,1),
('acc-4100','b-zeezicht','4100','Opgevraagd voorschot reservekapitaal (per kavel)',4,'asset','debit','reserve',0,1),
('acc-4101','b-zeezicht','4101','Opgevraagd voorschot werkkapitaal (per kavel)',4,'asset','debit','working',0,1),
('acc-416','b-zeezicht','416','Diverse vorderingen',4,'asset','debit',NULL,0,1),
('acc-417','b-zeezicht','417','Dubieuze debiteuren',4,'asset','debit',NULL,0,1),
('acc-419','b-zeezicht','419','Geboekte waardeverminderingen op vorderingen',4,'asset','debit',NULL,0,1),
('acc-42','b-zeezicht','42','Schulden > 1 jaar die binnen het jaar vervallen',4,'liability','credit',NULL,1,1),
('acc-423','b-zeezicht','423','Kredietinstellingen: vervallend binnen het jaar',4,'liability','credit',NULL,0,1),
('acc-43','b-zeezicht','43','Financiële schulden',4,'liability','credit',NULL,1,1),
('acc-430','b-zeezicht','430','Kredietinstellingen: leningen op rekening',4,'liability','credit',NULL,0,1),
('acc-433','b-zeezicht','433','Kredietinstellingen: schulden in rekening-courant',4,'liability','credit',NULL,0,1),
('acc-44','b-zeezicht','44','Handelsschulden',4,'liability','credit',NULL,1,1),
('acc-440','b-zeezicht','440','Leveranciers',4,'liability','credit',NULL,0,1),
('acc-444','b-zeezicht','444','Te ontvangen facturen',4,'liability','credit',NULL,0,1),
('acc-45','b-zeezicht','45','Schulden m.b.t. belastingen, bezoldigingen en sociale lasten',4,'liability','credit',NULL,1,1),
('acc-452','b-zeezicht','452','Te betalen belastingen en taksen',4,'liability','credit',NULL,0,1),
('acc-453','b-zeezicht','453','Ingehouden voorheffingen',4,'liability','credit',NULL,0,1),
('acc-454','b-zeezicht','454','Rijksdienst voor Sociale Zekerheid',4,'liability','credit',NULL,0,1),
('acc-455','b-zeezicht','455','Bezoldigingen',4,'liability','credit',NULL,0,1),
('acc-459','b-zeezicht','459','Andere sociale schulden',4,'liability','credit',NULL,0,1),
('acc-48','b-zeezicht','48','Diverse schulden',4,'liability','credit',NULL,1,1),
('acc-48901','b-zeezicht','48901','Overgedragen middelen: reservekapitaal',4,'liability','credit','reserve',0,1),
('acc-48902','b-zeezicht','48902','Overgedragen middelen: werkkapitaal',4,'liability','credit','working',0,1),
('acc-4890','b-zeezicht','4890','Overige diverse schulden',4,'liability','credit',NULL,0,1),
('acc-49','b-zeezicht','49','Overlopende rekeningen',4,'asset','debit',NULL,1,1),
('acc-490','b-zeezicht','490','Over te dragen kosten',4,'asset','debit',NULL,0,1),
('acc-491','b-zeezicht','491','Verkregen opbrengsten',4,'asset','debit',NULL,0,1),
('acc-492','b-zeezicht','492','Toe te rekenen kosten',4,'liability','credit',NULL,0,1),
('acc-493','b-zeezicht','493','Over te dragen opbrengsten',4,'liability','credit',NULL,0,1),
('acc-499','b-zeezicht','499','Wachtrekeningen',4,'asset','debit',NULL,0,1),
('acc-5','b-zeezicht','5','Geldbeleggingen en liquide middelen',5,'asset','debit',NULL,1,1),
('acc-530','b-zeezicht','530','Termijndeposito''s > 1 jaar',5,'asset','debit',NULL,0,1),
('acc-531','b-zeezicht','531','Termijndeposito''s 1 maand tot 1 jaar',5,'asset','debit',NULL,0,1),
('acc-532','b-zeezicht','532','Termijndeposito''s < 1 maand',5,'asset','debit',NULL,0,1),
('acc-550','b-zeezicht','550','Kredietinstellingen: rekening reservekapitaal',5,'asset','debit','reserve',0,1),
('acc-551','b-zeezicht','551','Kredietinstellingen: rekening werkkapitaal',5,'asset','debit','working',0,1),
('acc-552','b-zeezicht','552','Kredietinstellingen: andere rekeningen',5,'asset','debit',NULL,0,1),
('acc-570','b-zeezicht','570','Kas',5,'asset','debit',NULL,0,1),
('acc-580','b-zeezicht','580','Interne overboekingen',5,'asset','debit',NULL,0,1),
('acc-61','b-zeezicht','61','Diensten en diverse goederen',6,'expense','debit',NULL,1,1),
('acc-610','b-zeezicht','610','Onderhoud en kleine herstellingen',6,'expense','debit',NULL,1,1),
('acc-6100','b-zeezicht','6100','Brandbeveiliging',6,'expense','debit',NULL,0,1),
('acc-6101','b-zeezicht','6101','Liften',6,'expense','debit',NULL,0,1),
('acc-6102','b-zeezicht','6102','Elektrische installaties',6,'expense','debit',NULL,0,1),
('acc-6103','b-zeezicht','6103','Sanitair en verwarming',6,'expense','debit',NULL,0,1),
('acc-6104','b-zeezicht','6104','Schrijnwerk',6,'expense','debit',NULL,0,1),
('acc-6105','b-zeezicht','6105','Schoonmaak en afvalverwerking',6,'expense','debit',NULL,0,1),
('acc-6106','b-zeezicht','6106','Tuinen en parkings',6,'expense','debit',NULL,0,1),
('acc-6107','b-zeezicht','6107','Ruwbouw',6,'expense','debit',NULL,0,1),
('acc-6108','b-zeezicht','6108','Zwembad en technische installaties',6,'expense','debit',NULL,0,1),
('acc-6109','b-zeezicht','6109','Diverse onderhoudskosten',6,'expense','debit',NULL,0,1),
('acc-611','b-zeezicht','611','Renovatie en andere buitengewone werken',6,'expense','debit',NULL,1,1),
('acc-6110','b-zeezicht','6110','Studies en toezicht',6,'expense','debit',NULL,0,1),
('acc-6111','b-zeezicht','6111','Renovatiewerken',6,'expense','debit',NULL,0,1),
('acc-6112','b-zeezicht','6112','Verbouwingswerken',6,'expense','debit',NULL,0,1),
('acc-6113','b-zeezicht','6113','Uitbreidingswerken',6,'expense','debit',NULL,0,1),
('acc-612','b-zeezicht','612','Leveringen aan de vereniging',6,'expense','debit',NULL,1,1),
('acc-6120','b-zeezicht','6120','Water',6,'expense','debit',NULL,0,1),
('acc-6121','b-zeezicht','6121','Elektriciteit',6,'expense','debit',NULL,0,1),
('acc-6122','b-zeezicht','6122','Gas',6,'expense','debit',NULL,0,1),
('acc-6123','b-zeezicht','6123','Stookolie',6,'expense','debit',NULL,0,1),
('acc-6124','b-zeezicht','6124','Andere nutsvoorzieningen',6,'expense','debit',NULL,0,1),
('acc-6125','b-zeezicht','6125','Andere leveringen',6,'expense','debit',NULL,0,1),
('acc-613','b-zeezicht','613','Erelonen en kosten raad / commissaris',6,'expense','debit',NULL,1,1),
('acc-6130','b-zeezicht','6130','Erelonen (advocaten, architecten, experten)',6,'expense','debit',NULL,0,1),
('acc-6131','b-zeezicht','6131','Kosten raad van mede-eigendom en commissaris',6,'expense','debit',NULL,0,1),
('acc-614','b-zeezicht','614','Verzekeringen',6,'expense','debit',NULL,1,1),
('acc-6140','b-zeezicht','6140','Brandverzekering',6,'expense','debit',NULL,0,1),
('acc-6141','b-zeezicht','6141','Burgerlijke aansprakelijkheid',6,'expense','debit',NULL,0,1),
('acc-6142','b-zeezicht','6142','Arbeidsongevallen',6,'expense','debit',NULL,0,1),
('acc-6143','b-zeezicht','6143','Vrijwilligers',6,'expense','debit',NULL,0,1),
('acc-6144','b-zeezicht','6144','Raad van mede-eigendom en commissaris',6,'expense','debit',NULL,0,1),
('acc-6145','b-zeezicht','6145','Beroepsaansprakelijkheid niet-professionele syndicus',6,'expense','debit',NULL,0,1),
('acc-6146','b-zeezicht','6146','Rechtsbijstand',6,'expense','debit',NULL,0,1),
('acc-6147','b-zeezicht','6147','Vrijstellingen (franchises)',6,'expense','debit',NULL,0,1),
('acc-6148','b-zeezicht','6148','Andere verzekeringen',6,'expense','debit',NULL,0,1),
('acc-615','b-zeezicht','615','Conciërgewoning',6,'expense','debit',NULL,1,1),
('acc-6150','b-zeezicht','6150','Telecom conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-6151','b-zeezicht','6151','Elektriciteit conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-6152','b-zeezicht','6152','Water conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-6153','b-zeezicht','6153','Gas conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-6154','b-zeezicht','6154','Verwarming conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-6157','b-zeezicht','6157','Onderhoud conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-6158','b-zeezicht','6158','Andere kosten conciërgewoning',6,'expense','debit',NULL,0,1),
('acc-616','b-zeezicht','616','Administratie- en beheerskosten',6,'expense','debit',NULL,1,1),
('acc-6160','b-zeezicht','6160','Administratiekosten syndicus (ereloon)',6,'expense','debit',NULL,0,1),
('acc-6161','b-zeezicht','6161','Kosten algemene vergadering',6,'expense','debit',NULL,0,1),
('acc-6162','b-zeezicht','6162','Vertalingen',6,'expense','debit',NULL,0,1),
('acc-6163','b-zeezicht','6163','Procedurekosten',6,'expense','debit',NULL,0,1),
('acc-6164','b-zeezicht','6164','Publicaties en statutenwijzigingen',6,'expense','debit',NULL,0,1),
('acc-6165','b-zeezicht','6165','Kosten bij eigendomsoverdracht',6,'expense','debit',NULL,0,1),
('acc-6166','b-zeezicht','6166','Diverse beheerskosten',6,'expense','debit',NULL,0,1),
('acc-62','b-zeezicht','62','Bezoldigingen, sociale lasten en pensioenen',6,'expense','debit',NULL,1,1),
('acc-620','b-zeezicht','620','Bezoldigingen en rechtstreekse sociale voordelen',6,'expense','debit',NULL,0,1),
('acc-621','b-zeezicht','621','Werkgeversbijdragen sociale verzekeringen',6,'expense','debit',NULL,0,1),
('acc-622','b-zeezicht','622','Werkgeverspremies bovenwettelijke verzekeringen',6,'expense','debit',NULL,0,1),
('acc-623','b-zeezicht','623','Andere personeelskosten',6,'expense','debit',NULL,0,1),
('acc-624','b-zeezicht','624','Pensioenen',6,'expense','debit',NULL,0,1),
('acc-63','b-zeezicht','63','Afschrijvingen en waardeverminderingen',6,'expense','debit',NULL,1,1),
('acc-6301','b-zeezicht','6301','Afschrijvingen op immateriële vaste activa',6,'expense','debit',NULL,0,1),
('acc-6302','b-zeezicht','6302','Afschrijvingen op materiële vaste activa',6,'expense','debit',NULL,0,1),
('acc-6340','b-zeezicht','6340','Waardeverminderingen op vorderingen: toevoeging',6,'expense','debit',NULL,0,1),
('acc-6341','b-zeezicht','6341','Waardeverminderingen op vorderingen: terugneming',6,'expense','debit',NULL,0,1),
('acc-64','b-zeezicht','64','Andere kosten',6,'expense','debit',NULL,1,1),
('acc-640','b-zeezicht','640','Belastingen en taksen',6,'expense','debit',NULL,0,1),
('acc-641','b-zeezicht','641','Minderwaarden op realisatie van vorderingen',6,'expense','debit',NULL,0,1),
('acc-642','b-zeezicht','642','Diverse kosten',6,'expense','debit',NULL,0,1),
('acc-65','b-zeezicht','65','Financiële kosten',6,'expense','debit',NULL,1,1),
('acc-650','b-zeezicht','650','Bankkosten en kosten van schulden',6,'expense','debit',NULL,0,1),
('acc-657','b-zeezicht','657','Diverse financiële kosten',6,'expense','debit',NULL,0,1),
('acc-660','b-zeezicht','660','Uitzonderlijke kosten',6,'expense','debit',NULL,0,1),
('acc-693','b-zeezicht','693','Over te dragen middelen (resultaatverwerking)',6,'expense','debit',NULL,0,1),
('acc-70','b-zeezicht','70','Voorschotten van de mede-eigenaars',7,'income','credit',NULL,1,1),
('acc-700','b-zeezicht','700','Voorschotten reservekapitaal',7,'income','credit','reserve',0,1),
('acc-701','b-zeezicht','701','Voorschotten werkkapitaal',7,'income','credit','working',0,1),
('acc-740','b-zeezicht','740','Diverse opbrengsten (bv. huur gemene delen, recuperaties)',7,'income','credit',NULL,0,1),
('acc-751','b-zeezicht','751','Financiële opbrengsten: interesten reservekapitaal',7,'income','credit','reserve',0,1),
('acc-752','b-zeezicht','752','Financiële opbrengsten: interesten werkkapitaal',7,'income','credit','working',0,1),
('acc-760','b-zeezicht','760','Uitzonderlijke opbrengsten',7,'income','credit',NULL,0,1),
('acc-793','b-zeezicht','793','Onttrekking aan overgedragen middelen',7,'income','credit',NULL,0,1);
INSERT OR IGNORE INTO fiscal_years (id, building_id, label, start_date, end_date) VALUES ('fy-2026','b-zeezicht','2026','2026-01-01','2026-12-31'),('fy-2027','b-zeezicht','2027','2027-01-01','2027-12-31');
INSERT OR IGNORE INTO cost_keys (id, building_id, name, basis, is_default) VALUES ('ck-shares','b-zeezicht','Volgens aandelen (quotiteiten)','shares',1),('ck-lift','b-zeezicht','Lift (zonder gelijkvloers en garages)','custom',0);
INSERT OR IGNORE INTO cost_key_units (cost_key_id, unit_id, weight) VALUES ('ck-lift','un-a2',300),('ck-lift','un-a3',350);
INSERT OR IGNORE INTO bank_accounts (id, building_id, name, iban, account_id, fund) VALUES ('bank-w','b-zeezicht','Zichtrekening werkkapitaal','BE68539007547034','acc-551','working'),('bank-r','b-zeezicht','Spaarrekening reservekapitaal','BE71096123456769','acc-550','reserve');
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-call-w1','b-zeezicht','fy-2026',1,'2026-01-15','2026-01','Oproep werkkapitaal: voorschot 1e semester 2026',NULL,NULL,'posted','call','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-w1-0','je-call-w1','b-zeezicht','acc-4101',5000,0,'un-a1',NULL,'A1',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-w1-1','je-call-w1','b-zeezicht','acc-4101',6000,0,'un-a2',NULL,'A2',1);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-w1-2','je-call-w1','b-zeezicht','acc-4101',7000,0,'un-a3',NULL,'A3',2);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-w1-3','je-call-w1','b-zeezicht','acc-4101',1000,0,'un-g1',NULL,'G1',3);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-w1-4','je-call-w1','b-zeezicht','acc-4101',1000,0,'un-g2',NULL,'G2',4);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-w1-5','je-call-w1','b-zeezicht','acc-701',0,20000,NULL,NULL,NULL,5);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-call-r1','b-zeezicht','fy-2026',2,'2026-01-15','2026-01','Oproep reservekapitaal: jaarlijkse bijdrage 2026',NULL,NULL,'posted','call','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-r1-0','je-call-r1','b-zeezicht','acc-4100',2500,0,'un-a1',NULL,'A1',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-r1-1','je-call-r1','b-zeezicht','acc-4100',3000,0,'un-a2',NULL,'A2',1);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-r1-2','je-call-r1','b-zeezicht','acc-4100',3500,0,'un-a3',NULL,'A3',2);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-r1-3','je-call-r1','b-zeezicht','acc-4100',500,0,'un-g1',NULL,'G1',3);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-r1-4','je-call-r1','b-zeezicht','acc-4100',500,0,'un-g2',NULL,'G2',4);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-call-r1-5','je-call-r1','b-zeezicht','acc-700',0,10000,NULL,NULL,NULL,5);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-w-0','b-zeezicht','fy-2026',3,'2026-02-02','2026-02','Bijdrage werkkapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-0-0','je-pay-w-0','b-zeezicht','acc-551',5000,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-0-1','je-pay-w-0','b-zeezicht','acc-4101',0,5000,'un-a1',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-r-0','b-zeezicht','fy-2026',4,'2026-02-02','2026-02','Bijdrage reservekapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-0-0','je-pay-r-0','b-zeezicht','acc-550',2500,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-0-1','je-pay-r-0','b-zeezicht','acc-4100',0,2500,'un-a1',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-w-1','b-zeezicht','fy-2026',5,'2026-02-05','2026-02','Bijdrage werkkapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-1-0','je-pay-w-1','b-zeezicht','acc-551',6000,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-1-1','je-pay-w-1','b-zeezicht','acc-4101',0,6000,'un-a2',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-r-1','b-zeezicht','fy-2026',6,'2026-02-05','2026-02','Bijdrage reservekapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-1-0','je-pay-r-1','b-zeezicht','acc-550',3000,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-1-1','je-pay-r-1','b-zeezicht','acc-4100',0,3000,'un-a2',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-w-2','b-zeezicht','fy-2026',7,'2026-02-10','2026-02','Bijdrage werkkapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-2-0','je-pay-w-2','b-zeezicht','acc-551',7000,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-2-1','je-pay-w-2','b-zeezicht','acc-4101',0,7000,'un-a3',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-r-2','b-zeezicht','fy-2026',8,'2026-02-10','2026-02','Bijdrage reservekapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-2-0','je-pay-r-2','b-zeezicht','acc-550',3500,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-2-1','je-pay-r-2','b-zeezicht','acc-4100',0,3500,'un-a3',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-w-3','b-zeezicht','fy-2026',9,'2026-02-12','2026-02','Bijdrage werkkapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-3-0','je-pay-w-3','b-zeezicht','acc-551',1000,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-w-3-1','je-pay-w-3','b-zeezicht','acc-4101',0,1000,'un-g1',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-r-3','b-zeezicht','fy-2026',10,'2026-02-12','2026-02','Bijdrage reservekapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-3-0','je-pay-r-3','b-zeezicht','acc-550',500,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-3-1','je-pay-r-3','b-zeezicht','acc-4100',0,500,'un-g1',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-r-4','b-zeezicht','fy-2026',11,'2026-02-14','2026-02','Bijdrage reservekapitaal','owner_payment',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-4-0','je-pay-r-4','b-zeezicht','acc-550',500,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-r-4-1','je-pay-r-4','b-zeezicht','acc-4100',0,500,'un-g2',NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-inv-mazout','b-zeezicht','fy-2026',12,'2026-02-03','2026-02','Factuur Mazout Devos — levering stookolie 3.000 l','supplier_invoice','Mazout Devos','posted','template','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-inv-mazout-0','je-inv-mazout','b-zeezicht','acc-6123',5000,0,NULL,NULL,'werkkapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-inv-mazout-1','je-inv-mazout','b-zeezicht','acc-440',0,5000,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-pay-mazout','b-zeezicht','fy-2026',13,'2026-02-20','2026-02','Betaling Mazout Devos','supplier_payment','Mazout Devos','posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-mazout-0','je-pay-mazout','b-zeezicht','acc-440',5000,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-pay-mazout-1','je-pay-mazout','b-zeezicht','acc-551',0,5000,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-inv-kone','b-zeezicht','fy-2026',14,'2026-02-10','2026-02','Factuur Kone — onderhoudscontract liften Q1','supplier_invoice','Kone','posted','template','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-inv-kone-0','je-inv-kone','b-zeezicht','acc-6101',1200,0,NULL,'ck-lift','werkkapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-inv-kone-1','je-inv-kone','b-zeezicht','acc-440',0,1200,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-ins','b-zeezicht','fy-2026',15,'2026-03-01','2026-03','AXA — brandverzekering gebouw 2026','direct_expense','AXA','posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-ins-0','je-ins','b-zeezicht','acc-6140',2400,0,NULL,NULL,'werkkapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-ins-1','je-ins','b-zeezicht','acc-551',0,2400,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-synd','b-zeezicht','fy-2026',16,'2026-03-31','2026-03','Ereloon syndicus Q1 2026','direct_expense','Syndicus Vermeulen bv','posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-synd-0','je-synd','b-zeezicht','acc-6160',1800,0,NULL,NULL,'werkkapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-synd-1','je-synd','b-zeezicht','acc-551',0,1800,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-elec','b-zeezicht','fy-2026',17,'2026-04-05','2026-04','Engie — elektriciteit gemene delen maart','direct_expense','Engie Electrabel','posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-elec-0','je-elec','b-zeezicht','acc-6121',312.4,0,NULL,NULL,'werkkapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-elec-1','je-elec','b-zeezicht','acc-551',0,312.4,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-clean','b-zeezicht','fy-2026',18,'2026-04-30','2026-04','Clean & Shine — poetsen gemene delen april','supplier_invoice','Clean & Shine bv','posted','template','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-clean-0','je-clean','b-zeezicht','acc-6105',450,0,NULL,NULL,'werkkapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-clean-1','je-clean','b-zeezicht','acc-440',0,450,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-clean-pay','b-zeezicht','fy-2026',19,'2026-05-08','2026-05','Betaling Clean & Shine bv','supplier_payment','Clean & Shine bv','posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-clean-pay-0','je-clean-pay','b-zeezicht','acc-440',450,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-clean-pay-1','je-clean-pay','b-zeezicht','acc-551',0,450,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-fee','b-zeezicht','fy-2026',20,'2026-06-30','2026-06','Bankkosten 1e semester','bank_fee',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-fee-0','je-fee','b-zeezicht','acc-650',18.5,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-fee-1','je-fee','b-zeezicht','acc-551',0,18.5,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-int','b-zeezicht','fy-2026',21,'2026-06-30','2026-06','Creditinteresten spaarrekening','interest',NULL,'posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-int-0','je-int','b-zeezicht','acc-550',45.2,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-int-1','je-int','b-zeezicht','acc-751',0,45.2,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-asset','b-zeezicht','fy-2026',22,'2026-03-15','2026-03','Aankoop vast actief: grasmaaier Honda','asset_purchase','Tuincenter Mol','posted','template','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-asset-0','je-asset','b-zeezicht','acc-2300',2800,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-asset-1','je-asset','b-zeezicht','acc-440',0,2800,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-asset-pay','b-zeezicht','fy-2026',23,'2026-03-20','2026-03','Betaling Tuincenter Mol','supplier_payment','Tuincenter Mol','posted','bank','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-asset-pay-0','je-asset-pay','b-zeezicht','acc-440',2800,0,NULL,NULL,NULL,0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-asset-pay-1','je-asset-pay','b-zeezicht','acc-550',0,2800,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-depr-1','b-zeezicht','fy-2026',24,'2026-12-31','2026-12','Afschrijving grasmaaier Honda (1/5)',NULL,NULL,'scheduled','depreciation','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-depr-1-0','je-depr-1','b-zeezicht','acc-6302',560,0,NULL,NULL,'reservekapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-depr-1-1','je-depr-1','b-zeezicht','acc-2309',0,560,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES ('je-depr-2','b-zeezicht','fy-2027',25,'2027-12-31','2027-12','Afschrijving grasmaaier Honda (2/5)',NULL,NULL,'scheduled','depreciation','u-syndicus');
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-depr-2-0','je-depr-2','b-zeezicht','acc-6302',560,0,NULL,NULL,'reservekapitaal',0);
INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES ('je-depr-2-1','je-depr-2','b-zeezicht','acc-2309',0,560,NULL,NULL,NULL,1);
INSERT OR IGNORE INTO contribution_calls (id, building_id, fiscal_year_id, fund, date, due_date, description, total, cost_key_id, entry_id) VALUES ('call-w1','b-zeezicht','fy-2026','working','2026-01-15','2026-02-15','Voorschot 1e semester 2026',20000,NULL,'je-call-w1'),('call-r1','b-zeezicht','fy-2026','reserve','2026-01-15','2026-02-15','Jaarlijkse bijdrage reservekapitaal 2026',10000,NULL,'je-call-r1');
INSERT OR IGNORE INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES ('ccl-w1-0','call-w1','un-a1',5000,'+++001/0001/19813+++'),('ccl-r1-0','call-r1','un-a1',2500,'+++002/0001/99816+++');
INSERT OR IGNORE INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES ('ccl-w1-1','call-w1','un-a2',6000,'+++001/0002/19843+++'),('ccl-r1-1','call-r1','un-a2',3000,'+++002/0002/99846+++');
INSERT OR IGNORE INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES ('ccl-w1-2','call-w1','un-a3',7000,'+++001/0003/19873+++'),('ccl-r1-2','call-r1','un-a3',3500,'+++002/0003/99876+++');
INSERT OR IGNORE INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES ('ccl-w1-3','call-w1','un-g1',1000,'+++001/0004/19806+++'),('ccl-r1-3','call-r1','un-g1',500,'+++002/0004/99809+++');
INSERT OR IGNORE INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES ('ccl-w1-4','call-w1','un-g2',1000,'+++001/0005/19836+++'),('ccl-r1-4','call-r1','un-g2',500,'+++002/0005/99839+++');
INSERT OR IGNORE INTO fixed_assets (id, building_id, name, asset_account_id, depreciation_account_id, expense_account_id, cost, acquired_at, years, frequency, purchase_entry_id) VALUES ('fa-maaier','b-zeezicht','grasmaaier Honda','acc-2300','acc-2309','acc-6302',2800,'2026-03-15',5,'yearly','je-asset');
INSERT OR IGNORE INTO bank_transactions (id, building_id, bank_account_id, date, amount, counterparty_name, counterparty_iban, communication, structured_ref, external_ref, source) VALUES
 ('bt-1','b-zeezicht','bank-w','2026-10-01',-89.5,'ENGIE ELECTRABEL','BE99888877776666','DOMICILIERING ELEKTRICITEIT SEPT',NULL,'seed-bt-1','coda'),
 ('bt-2','b-zeezicht','bank-w','2026-10-03',1000,'DE SMET LOTTE','BE12345678901234','+++001/0005/19836+++','001000519836','seed-bt-2','coda'),
 ('bt-3','b-zeezicht','bank-w','2026-10-05',-12.5,NULL,NULL,'BANKKOSTEN SEPTEMBER',NULL,'seed-bt-3','csv'),
 ('bt-4','b-zeezicht','bank-w','2026-10-07',-1200,'KONE BELGIUM','BE11222233334444','factuur 2026-0442 lift Q1',NULL,'seed-bt-4','csv');
INSERT OR IGNORE INTO budgets (id, building_id, fiscal_year_id, status, notes) VALUES ('bud-2026','b-zeezicht','fy-2026','approved','Goedgekeurd op de AV van 2025. Reservekapitaal: dakrenovatie voorzien in 2027.');
INSERT OR IGNORE INTO budget_lines (id, budget_id, account_id, kind, amount) VALUES ('bl-1','bud-2026','acc-6123','ordinary',6000),('bl-2','bud-2026','acc-6101','ordinary',4800),('bl-3','bud-2026','acc-6140','ordinary',2400),('bl-4','bud-2026','acc-6160','ordinary',7200),('bl-5','bud-2026','acc-6121','ordinary',3600),('bl-6','bud-2026','acc-6105','ordinary',5400),('bl-7','bud-2026','acc-6111','extraordinary',15000);
INSERT OR IGNORE INTO ledger_comments (id, building_id, entry_id, author_id, body, kind) VALUES ('lc-1','b-zeezicht','je-inv-kone','u-jan','Graag het onderhoudscontract van Kone toevoegen als verantwoordingsstuk.','remark');
