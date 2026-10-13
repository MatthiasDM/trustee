// Genereert migrations/seed.sql met demo-accounts (wachtwoord: wachtwoord123)
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";
import { KB_CHART } from "../src/worker/lib/chart.ts";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function hash(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${b64u(salt)}$${b64u(bits)}`;
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
INSERT OR IGNORE INTO meetings (id, building_id, title, type, starts_at, location, agenda, created_by) VALUES
 ('m-1','b-zeezicht','Jaarlijkse algemene vergadering 2026','av',strftime('%Y-%m-%dT18:30:00.000Z','now','+21 days'),'Inkomhal, gelijkvloers','1. Goedkeuring verslag vorige AV\n2. Jaarrekening 2025 en kwijting syndicus\n3. Begroting 2026\n4. Dakrenovatie: toelichting en stemming\n5. Varia','u-syndicus');
INSERT OR IGNORE INTO agenda_items (id, building_id, meeting_id, submitted_by, title, description, required_majority, status, position, poll_id) VALUES
 ('ag-1','b-zeezicht','m-1','u-syndicus','Goedkeuring verslag vorige AV',NULL,'simple','scheduled',1,NULL),
 ('ag-2','b-zeezicht','m-1','u-syndicus','Jaarrekening 2025 en kwijting syndicus','Verslag van de commissaris van de rekeningen wordt toegevoegd.','simple','scheduled',2,NULL),
 ('ag-3','b-zeezicht','m-1','u-syndicus','Dakrenovatie: goedkeuring offerte Dakwerken Devos','Zie stemming.','two_thirds','scheduled',3,'poll-1'),
 ('ag-4','b-zeezicht',NULL,'u-marie','Fietsenstalling uitbreiden','Er is plaats tekort voor fietsen. Voorstel om de berging naast de inkom om te vormen.','two_thirds','proposed',0,NULL);
`;

// ---------- Boekhouding ----------
const B = "b-zeezicht";
const esc = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const accId = (code) => `acc-${code}`;
const classOf = (code) => parseInt(code[0], 10);
const side = (t) => (t === "asset" || t === "expense" ? "debit" : "credit");
let L = [];
L.push(`INSERT OR IGNORE INTO accounts (id, building_id, code, name, class, type, normal_side, fund, is_header, is_system) VALUES\n` + KB_CHART.map((a) => `(${esc(accId(a.code))},${esc(B)},${esc(a.code)},${esc(a.name)},${classOf(a.code)},${esc(a.type)},${esc(side(a.type))},${esc(a.fund ?? null)},${a.header ? 1 : 0},1)`).join(",\n") + ";");
L.push(`INSERT OR IGNORE INTO fiscal_years (id, building_id, label, start_date, end_date) VALUES ('fy-2026',${esc(B)},'2026','2026-01-01','2026-12-31'),('fy-2027',${esc(B)},'2027','2027-01-01','2027-12-31');`);
L.push(`INSERT OR IGNORE INTO cost_keys (id, building_id, name, basis, is_default) VALUES ('ck-shares',${esc(B)},'Volgens aandelen (quotiteiten)','shares',1),('ck-lift',${esc(B)},'Lift (zonder gelijkvloers en garages)','custom',0);`);
L.push(`INSERT OR IGNORE INTO cost_key_units (cost_key_id, unit_id, weight) VALUES ('ck-lift','un-a2',300),('ck-lift','un-a3',350);`);
const PRE = L; L = [];
PRE.push(`INSERT OR IGNORE INTO bank_accounts (id, building_id, name, iban, account_id, fund) VALUES ('bank-w',${esc(B)},'Zichtrekening werkkapitaal','BE68539007547034','acc-551','working'),('bank-r',${esc(B)},'Spaarrekening reservekapitaal','BE71096123456769','acc-550','reserve');`);
let n = 0;
const entries = [];
// lines: [code, debit, credit, unit_id?, cost_key_id?, memo?]
const entry = (id, date, description, lines, opts = {}) => {
  n++;
  const d = lines.reduce((s, l) => s + (l[1] || 0), 0), c = lines.reduce((s, l) => s + (l[2] || 0), 0);
  if (Math.abs(d - c) > 0.004) throw new Error(`Seed-boeking ${id} niet in evenwicht: ${d} / ${c}`);
  const fy = date < "2027-01-01" ? "fy-2026" : "fy-2027";
  entries.push(`INSERT OR IGNORE INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, status, source, created_by) VALUES (${esc(id)},${esc(B)},${esc(fy)},${n},${esc(date)},${esc(date.slice(0, 7))},${esc(description)},${esc(opts.template ?? null)},${esc(opts.counterparty ?? null)},${esc(opts.status ?? "posted")},${esc(opts.source ?? "template")},'u-syndicus');`);
  lines.forEach((l, i) => entries.push(`INSERT OR IGNORE INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES (${esc(id + "-" + i)},${esc(id)},${esc(B)},${esc(accId(l[0]))},${l[1] || 0},${l[2] || 0},${esc(l[3] ?? null)},${esc(l[4] ?? null)},${esc(l[5] ?? null)},${i});`));
};
const units = [["un-a1", "A1", 250], ["un-a2", "A2", 300], ["un-a3", "A3", 350], ["un-g1", "G1", 50], ["un-g2", "G2", 50]];
const ogm = (base) => { const b = base.padStart(10, "0").slice(-10); let m = parseInt(b, 10) % 97; if (m === 0) m = 97; const f = b + String(m).padStart(2, "0"); return `+++${f.slice(0, 3)}/${f.slice(3, 7)}/${f.slice(7)}+++`; };
// 1. Oproep werkkapitaal 20.000 (1e semester) + oproep reservekapitaal 10.000
entry("je-call-w1", "2026-01-15", "Oproep werkkapitaal: voorschot 1e semester 2026", [...units.map((u) => ["4101", u[2] * 20, 0, u[0], null, u[1]]), ["701", 0, 20000]], { source: "call" });
entry("je-call-r1", "2026-01-15", "Oproep reservekapitaal: jaarlijkse bijdrage 2026", [...units.map((u) => ["4100", u[2] * 10, 0, u[0], null, u[1]]), ["700", 0, 10000]], { source: "call" });
L.push(`INSERT OR IGNORE INTO contribution_calls (id, building_id, fiscal_year_id, fund, date, due_date, description, total, cost_key_id, entry_id) VALUES ('call-w1',${esc(B)},'fy-2026','working','2026-01-15','2026-02-15','Voorschot 1e semester 2026',20000,NULL,'je-call-w1'),('call-r1',${esc(B)},'fy-2026','reserve','2026-01-15','2026-02-15','Jaarlijkse bijdrage reservekapitaal 2026',10000,NULL,'je-call-r1');`);
units.forEach((u, i) => { L.push(`INSERT OR IGNORE INTO contribution_call_lines (id, call_id, unit_id, amount, ogm) VALUES ('ccl-w1-${i}','call-w1',${esc(u[0])},${u[2] * 20},${esc(ogm(`001${String(i + 1).padStart(4, "0")}198`))}),('ccl-r1-${i}','call-r1',${esc(u[0])},${u[2] * 10},${esc(ogm(`002${String(i + 1).padStart(4, "0")}998`))});`); });
// 2. Betalingen van eigenaars (G2 betaalt werkkapitaal niet)
const pays = [["un-a1", "2026-02-02", 5000, 2500], ["un-a2", "2026-02-05", 6000, 3000], ["un-a3", "2026-02-10", 7000, 3500], ["un-g1", "2026-02-12", 1000, 500], ["un-g2", "2026-02-14", 0, 500]];
pays.forEach((p, i) => { if (p[2]) entry(`je-pay-w-${i}`, p[1], "Bijdrage werkkapitaal", [["551", p[2], 0], ["4101", 0, p[2], p[0]]], { template: "owner_payment", source: "bank" }); entry(`je-pay-r-${i}`, p[1], "Bijdrage reservekapitaal", [["550", p[3], 0], ["4100", 0, p[3], p[0]]], { template: "owner_payment", source: "bank" }); });
// 3. Kosten
entry("je-inv-mazout", "2026-02-03", "Factuur Mazout Devos — levering stookolie 3.000 l", [["6123", 5000, 0, null, null, "werkkapitaal"], ["440", 0, 5000]], { template: "supplier_invoice", counterparty: "Mazout Devos" });
entry("je-pay-mazout", "2026-02-20", "Betaling Mazout Devos", [["440", 5000, 0], ["551", 0, 5000]], { template: "supplier_payment", counterparty: "Mazout Devos", source: "bank" });
entry("je-inv-kone", "2026-02-10", "Factuur Kone — onderhoudscontract liften Q1", [["6101", 1200, 0, null, "ck-lift", "werkkapitaal"], ["440", 0, 1200]], { template: "supplier_invoice", counterparty: "Kone" });
entry("je-ins", "2026-03-01", "AXA — brandverzekering gebouw 2026", [["6140", 2400, 0, null, null, "werkkapitaal"], ["551", 0, 2400]], { template: "direct_expense", counterparty: "AXA", source: "bank" });
entry("je-synd", "2026-03-31", "Ereloon syndicus Q1 2026", [["6160", 1800, 0, null, null, "werkkapitaal"], ["551", 0, 1800]], { template: "direct_expense", counterparty: "Syndicus Vermeulen bv", source: "bank" });
entry("je-elec", "2026-04-05", "Engie — elektriciteit gemene delen maart", [["6121", 312.4, 0, null, null, "werkkapitaal"], ["551", 0, 312.4]], { template: "direct_expense", counterparty: "Engie Electrabel", source: "bank" });
entry("je-clean", "2026-04-30", "Clean & Shine — poetsen gemene delen april", [["6105", 450, 0, null, null, "werkkapitaal"], ["440", 0, 450]], { template: "supplier_invoice", counterparty: "Clean & Shine bv" });
entry("je-clean-pay", "2026-05-08", "Betaling Clean & Shine bv", [["440", 450, 0], ["551", 0, 450]], { template: "supplier_payment", counterparty: "Clean & Shine bv", source: "bank" });
entry("je-fee", "2026-06-30", "Bankkosten 1e semester", [["650", 18.5, 0], ["551", 0, 18.5]], { template: "bank_fee", source: "bank" });
entry("je-int", "2026-06-30", "Creditinteresten spaarrekening", [["550", 45.2, 0], ["751", 0, 45.2]], { template: "interest", source: "bank" });
// 4. Vast actief: grasmaaier 2.800 (reservekapitaal), afschrijving 5 jaar
entry("je-asset", "2026-03-15", "Aankoop vast actief: grasmaaier Honda", [["2300", 2800, 0], ["440", 0, 2800]], { template: "asset_purchase", counterparty: "Tuincenter Mol" });
entry("je-asset-pay", "2026-03-20", "Betaling Tuincenter Mol", [["440", 2800, 0], ["550", 0, 2800]], { template: "supplier_payment", counterparty: "Tuincenter Mol", source: "bank" });
L.push(`INSERT OR IGNORE INTO fixed_assets (id, building_id, name, asset_account_id, depreciation_account_id, expense_account_id, cost, acquired_at, years, frequency, purchase_entry_id) VALUES ('fa-maaier',${esc(B)},'grasmaaier Honda','acc-2300','acc-2309','acc-6302',2800,'2026-03-15',5,'yearly','je-asset');`);
entry("je-depr-1", "2026-12-31", "Afschrijving grasmaaier Honda (1/5)", [["6302", 560, 0, null, null, "reservekapitaal"], ["2309", 0, 560]], { source: "depreciation", status: "scheduled" });
entry("je-depr-2", "2027-12-31", "Afschrijving grasmaaier Honda (2/5)", [["6302", 560, 0, null, null, "reservekapitaal"], ["2309", 0, 560]], { source: "depreciation", status: "scheduled" });

// 5. Nog te verwerken bankverrichtingen
L.push(`INSERT OR IGNORE INTO bank_transactions (id, building_id, bank_account_id, date, amount, counterparty_name, counterparty_iban, communication, structured_ref, external_ref, source) VALUES
 ('bt-1',${esc(B)},'bank-w','2026-10-01',-89.5,'ENGIE ELECTRABEL','BE99888877776666','DOMICILIERING ELEKTRICITEIT SEPT',NULL,'seed-bt-1','coda'),
 ('bt-2',${esc(B)},'bank-w','2026-10-03',1000,'DE SMET LOTTE','BE12345678901234',${esc(ogm("0010005198"))},${esc(ogm("0010005198").replace(/\D/g, ""))},'seed-bt-2','coda'),
 ('bt-3',${esc(B)},'bank-w','2026-10-05',-12.5,NULL,NULL,'BANKKOSTEN SEPTEMBER',NULL,'seed-bt-3','csv'),
 ('bt-4',${esc(B)},'bank-w','2026-10-07',-1200,'KONE BELGIUM','BE11222233334444','factuur 2026-0442 lift Q1',NULL,'seed-bt-4','csv');`);
// 6. Begroting 2026
L.push(`INSERT OR IGNORE INTO budgets (id, building_id, fiscal_year_id, status, notes) VALUES ('bud-2026',${esc(B)},'fy-2026','approved','Goedgekeurd op de AV van 2025. Reservekapitaal: dakrenovatie voorzien in 2027.');`);
L.push(`INSERT OR IGNORE INTO budget_lines (id, budget_id, account_id, kind, amount) VALUES ('bl-1','bud-2026','acc-6123','ordinary',6000),('bl-2','bud-2026','acc-6101','ordinary',4800),('bl-3','bud-2026','acc-6140','ordinary',2400),('bl-4','bud-2026','acc-6160','ordinary',7200),('bl-5','bud-2026','acc-6121','ordinary',3600),('bl-6','bud-2026','acc-6105','ordinary',5400),('bl-7','bud-2026','acc-6111','extraordinary',15000);`);
L.push(`INSERT OR IGNORE INTO ledger_comments (id, building_id, entry_id, author_id, body, kind) VALUES ('lc-1',${esc(B)},'je-inv-kone','u-jan','Graag het onderhoudscontract van Kone toevoegen als verantwoordingsstuk.','remark');`);
const ledgerSql = "\n-- Boekhouding demo (boekjaar 2026)\n" + [...PRE, ...entries, ...L].join("\n") + "\n";
writeFileSync(new URL("../seed/seed.sql", import.meta.url), sql + ledgerSql);
console.log("seed.sql geschreven");
