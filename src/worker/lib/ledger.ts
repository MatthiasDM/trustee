import type { Env } from "../env";
import { HttpError, uid } from "./util";
import { KB_CHART, classOf, normalSide } from "./chart";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- Rekeningenstelsel ----------
export async function ensureChart(env: Env, buildingId: string) {
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE building_id = ?").bind(buildingId).first<{ n: number }>();
  if (existing && existing.n > 0) return;
  const stmt = env.DB.prepare("INSERT OR IGNORE INTO accounts (id, building_id, code, name, class, type, normal_side, fund, is_header, is_system) VALUES (?,?,?,?,?,?,?,?,?,1)");
  await env.DB.batch(KB_CHART.map((a) => stmt.bind(uid(), buildingId, a.code, a.name, classOf(a.code), a.type, normalSide(a.type), a.fund ?? null, a.header ? 1 : 0)));
  // standaard verdeelsleutel: volgens aandelen
  await env.DB.prepare("INSERT INTO cost_keys (id, building_id, name, basis, is_default) VALUES (?, ?, 'Volgens aandelen (quotiteiten)', 'shares', 1)").bind(uid(), buildingId).run();
}

export async function accountByCode(env: Env, buildingId: string, code: string) {
  const a = await env.DB.prepare("SELECT * FROM accounts WHERE building_id = ? AND code = ? AND is_header = 0 AND active = 1").bind(buildingId, code).first<any>();
  if (!a) throw new HttpError(400, `Rekening ${code} bestaat niet of is niet boekbaar`);
  return a;
}

// ---------- Boekjaar ----------
export async function fiscalYearFor(env: Env, buildingId: string, date: string) {
  const fy = await env.DB.prepare("SELECT * FROM fiscal_years WHERE building_id = ? AND start_date <= ? AND end_date >= ?").bind(buildingId, date, date).first<any>();
  if (!fy) throw new HttpError(400, `Geen boekjaar voor datum ${date}. Maak eerst een boekjaar aan.`);
  if (fy.status === "closed") throw new HttpError(400, `Boekjaar ${fy.label} is afgesloten`);
  return fy;
}

// ---------- Journaalpost boeken ----------
export interface LineInput { account_code?: string; account_id?: string; debit?: number; credit?: number; unit_id?: string | null; cost_key_id?: string | null; memo?: string | null }
export interface EntryInput { date: string; description: string; lines: LineInput[]; template_code?: string | null; counterparty?: string | null; document_id?: string | null; source?: string; status?: "posted" | "scheduled"; reverses_entry_id?: string | null }

/** Valideert (balans, boekjaar, rekeningen) en schrijft een journaalpost. Geeft het id terug. */
export async function postEntry(env: Env, buildingId: string, userId: string | null, input: EntryInput): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new HttpError(400, "Ongeldige datum");
  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  if (lines.length < 2) throw new HttpError(400, "Een journaalpost heeft minstens twee lijnen");
  let d = 0, c = 0;
  for (const l of lines) {
    if ((l.debit ?? 0) < 0 || (l.credit ?? 0) < 0) throw new HttpError(400, "Negatieve bedragen zijn niet toegelaten; gebruik de andere zijde");
    if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) throw new HttpError(400, "Een lijn is debet óf credit");
    d += l.debit ?? 0; c += l.credit ?? 0;
  }
  if (Math.abs(round2(d) - round2(c)) > 0.004) throw new HttpError(400, `Journaalpost is niet in evenwicht: debet ${round2(d).toFixed(2)} ≠ credit ${round2(c).toFixed(2)}`);
  const fy = await fiscalYearFor(env, buildingId, input.date);
  const resolved = [];
  for (const l of lines) {
    const acc = l.account_id ? await env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND building_id = ? AND is_header = 0").bind(l.account_id, buildingId).first<any>() : await accountByCode(env, buildingId, l.account_code!);
    if (!acc) throw new HttpError(400, "Onbekende rekening");
    resolved.push({ ...l, account_id: acc.id });
  }
  const next = await env.DB.prepare("SELECT COALESCE(MAX(number),0)+1 AS n FROM journal_entries WHERE fiscal_year_id = ?").bind(fy.id).first<{ n: number }>();
  const id = uid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO journal_entries (id, building_id, fiscal_year_id, number, date, period, description, template_code, counterparty, document_id, status, reverses_entry_id, source, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, buildingId, fy.id, next!.n, input.date, input.date.slice(0, 7), input.description, input.template_code ?? null, input.counterparty ?? null, input.document_id ?? null, input.status ?? "posted", input.reverses_entry_id ?? null, input.source ?? "manual", userId),
    ...resolved.map((l, i) => env.DB.prepare("INSERT INTO journal_lines (id, entry_id, building_id, account_id, debit, credit, unit_id, cost_key_id, memo, position) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(uid(), id, buildingId, l.account_id, round2(l.debit ?? 0), round2(l.credit ?? 0), l.unit_id ?? null, l.cost_key_id ?? null, l.memo ?? null, i)),
  ]);
  return id;
}

/** Tegenboeking: zelfde lijnen, zijden gewisseld. Boekingen zijn onwijzigbaar; dit is de enige correctieweg. */
export async function reverseEntry(env: Env, buildingId: string, userId: string, entryId: string, date: string, reason: string) {
  const e = await env.DB.prepare("SELECT * FROM journal_entries WHERE id = ? AND building_id = ?").bind(entryId, buildingId).first<any>();
  if (!e) throw new HttpError(404, "Boeking niet gevonden");
  if (e.status === "reversed") throw new HttpError(400, "Deze boeking is al tegengeboekt");
  const lines = (await env.DB.prepare("SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY position").bind(entryId).all()).results as any[];
  const id = await postEntry(env, buildingId, userId, { date, description: `Tegenboeking #${e.number}: ${reason}`, counterparty: e.counterparty, source: "manual", reverses_entry_id: e.id, lines: lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, unit_id: l.unit_id, cost_key_id: l.cost_key_id, memo: l.memo })) });
  await env.DB.prepare("UPDATE journal_entries SET status = 'reversed', reversed_by_entry_id = ? WHERE id = ?").bind(id, e.id).run();
  return id;
}

// ---------- Verdeelsleutels ----------
/** Gewichten per kavel voor een sleutel (of de standaard: aandelen). */
export async function keyWeights(env: Env, buildingId: string, costKeyId: string | null): Promise<Map<string, number>> {
  const key = costKeyId ? await env.DB.prepare("SELECT * FROM cost_keys WHERE id = ? AND building_id = ?").bind(costKeyId, buildingId).first<any>() : await env.DB.prepare("SELECT * FROM cost_keys WHERE building_id = ? AND is_default = 1").bind(buildingId).first<any>();
  const units = (await env.DB.prepare("SELECT id, shares FROM units WHERE building_id = ?").bind(buildingId).all()).results as any[];
  const map = new Map<string, number>();
  if (!key || key.basis === "shares") { for (const u of units) map.set(u.id, u.shares); }
  else if (key.basis === "equal") { for (const u of units) map.set(u.id, 1); }
  else { const rows = (await env.DB.prepare("SELECT unit_id, weight FROM cost_key_units WHERE cost_key_id = ?").bind(key.id).all()).results as any[]; for (const r of rows) if (r.weight > 0) map.set(r.unit_id, r.weight); }
  return map;
}

/** Verdeelt een bedrag over kavels volgens gewichten; afrondingsverschil op de grootste kavel. */
export function allocate(total: number, weights: Map<string, number>): Map<string, number> {
  const sum = [...weights.values()].reduce((s, w) => s + w, 0);
  const out = new Map<string, number>();
  if (sum <= 0) return out;
  let acc = 0; let maxId = ""; let maxW = -1;
  for (const [id, w] of weights) { const v = round2((total * w) / sum); out.set(id, v); acc += v; if (w > maxW) { maxW = w; maxId = id; } }
  const diff = round2(total - acc);
  if (diff !== 0 && maxId) out.set(maxId, round2(out.get(maxId)! + diff));
  return out;
}

// ---------- Gestructureerde mededeling (OGM / VCS) ----------
/** Belgische gestructureerde mededeling: 10 cijfers + controlegetal (mod 97, 0 → 97). */
export function ogm(base10: string): string {
  const n = base10.padStart(10, "0").slice(-10);
  let mod = parseInt(n, 10) % 97; if (mod === 0) mod = 97;
  const full = n + String(mod).padStart(2, "0");
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7)}+++`;
}
export const ogmDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-12);
export function ogmValid(digits: string) { if (digits.length !== 12) return false; let mod = parseInt(digits.slice(0, 10), 10) % 97; if (mod === 0) mod = 97; return mod === parseInt(digits.slice(10), 10); }

// ---------- Handelingen (sjablonen) ----------
export interface TemplateField { key: string; label: string; type: "amount" | "date" | "text" | "account" | "unit" | "cost_key" | "fund" | "bank" | "document" | "select"; required?: boolean; default?: string; filter?: string; options?: { value: string; label: string }[]; hint?: string }
export interface Template { code: string; name: string; group: string; description: string; fields: TemplateField[]; build: (v: Record<string, any>, ctx: TemplateCtx) => { description: string; counterparty?: string; lines: LineInput[] } | Promise<{ description: string; counterparty?: string; lines: LineInput[] }> }
export interface TemplateCtx { bankCodeFor: (bankAccountId: string) => Promise<string>; fundOf: (bankAccountId: string) => Promise<"working" | "reserve"> }

const amount: TemplateField = { key: "amount", label: "Bedrag (€)", type: "amount", required: true };
const date: TemplateField = { key: "date", label: "Datum", type: "date", required: true };
const doc: TemplateField = { key: "document_id", label: "Verantwoordingsstuk (document)", type: "document", hint: "Factuur, uittreksel of bon; wettelijk verplicht (7 jaar bewaren)." };
const bank: TemplateField = { key: "bank_account_id", label: "Bankrekening", type: "bank", required: true };

export const TEMPLATES: Template[] = [
  {
    code: "supplier_invoice", name: "Factuur leverancier", group: "Kosten", description: "Kost boeken op een kostenrekening, schuld aan leverancier (440).",
    fields: [date, { key: "counterparty", label: "Leverancier", type: "text", required: true }, amount, { key: "expense_code", label: "Kostenrekening", type: "account", filter: "6", required: true }, { key: "cost_key_id", label: "Verdeelsleutel", type: "cost_key", hint: "Hoe deze kost over de kavels verdeeld wordt in de afrekening." }, { key: "fund", label: "Ten laste van", type: "fund", default: "working" }, doc],
    build: (v) => ({ description: `Factuur ${v.counterparty}${v.memo ? ` — ${v.memo}` : ""}`, counterparty: v.counterparty, lines: [{ account_code: v.expense_code, debit: +v.amount, cost_key_id: v.cost_key_id || null, memo: v.fund === "reserve" ? "reservekapitaal" : "werkkapitaal" }, { account_code: "440", credit: +v.amount }] }),
  },
  {
    code: "supplier_payment", name: "Betaling leverancier", group: "Bank", description: "Openstaande leveranciersschuld betalen via de bank.",
    fields: [date, { key: "counterparty", label: "Leverancier", type: "text", required: true }, amount, bank, doc],
    build: async (v, ctx) => ({ description: `Betaling ${v.counterparty}`, counterparty: v.counterparty, lines: [{ account_code: "440", debit: +v.amount }, { account_code: await ctx.bankCodeFor(v.bank_account_id), credit: +v.amount }] }),
  },
  {
    code: "direct_expense", name: "Kost rechtstreeks betaald via bank", group: "Bank", description: "Kost zonder aparte factuurboeking (bv. domiciliëring nutsvoorziening, bankkosten).",
    fields: [date, { key: "counterparty", label: "Tegenpartij", type: "text" }, amount, { key: "expense_code", label: "Kostenrekening", type: "account", filter: "6", required: true }, { key: "cost_key_id", label: "Verdeelsleutel", type: "cost_key" }, bank, doc],
    build: async (v, ctx) => ({ description: `${v.counterparty || "Kost"} via bank`, counterparty: v.counterparty, lines: [{ account_code: v.expense_code, debit: +v.amount, cost_key_id: v.cost_key_id || null }, { account_code: await ctx.bankCodeFor(v.bank_account_id), credit: +v.amount }] }),
  },
  {
    code: "owner_payment", name: "Bijdrage ontvangen van mede-eigenaar", group: "Bank", description: "Betaling van een opgevraagd voorschot door een mede-eigenaar (vermindert de vordering per kavel).",
    fields: [date, { key: "unit_id", label: "Kavel", type: "unit", required: true }, amount, bank, doc],
    build: async (v, ctx) => { const f = await ctx.fundOf(v.bank_account_id); return { description: `Bijdrage ${f === "reserve" ? "reservekapitaal" : "werkkapitaal"} kavel`, lines: [{ account_code: await ctx.bankCodeFor(v.bank_account_id), debit: +v.amount }, { account_code: f === "reserve" ? "4100" : "4101", credit: +v.amount, unit_id: v.unit_id }] }; },
  },
  {
    code: "asset_purchase", name: "Aankoop vast actief", group: "Vaste activa", description: "Investering (bv. grasmaaier, camera's) op de balans; wordt afgeschreven, geen kost op aankoopmoment.",
    fields: [date, { key: "counterparty", label: "Leverancier", type: "text", required: true }, amount, { key: "asset_code", label: "Activarekening", type: "account", filter: "2", default: "2300", required: true }, doc],
    build: (v) => ({ description: `Aankoop vast actief: ${v.memo || v.counterparty}`, counterparty: v.counterparty, lines: [{ account_code: v.asset_code, debit: +v.amount }, { account_code: "440", credit: +v.amount }] }),
  },
  {
    code: "interest", name: "Interesten ontvangen", group: "Bank", description: "Creditinteresten op de bankrekening.",
    fields: [date, amount, bank, doc],
    build: async (v, ctx) => { const f = await ctx.fundOf(v.bank_account_id); return { description: "Creditinteresten", lines: [{ account_code: await ctx.bankCodeFor(v.bank_account_id), debit: +v.amount }, { account_code: f === "reserve" ? "751" : "752", credit: +v.amount }] }; },
  },
  {
    code: "bank_fee", name: "Bankkosten", group: "Bank", description: "Kosten aangerekend door de bank.",
    fields: [date, amount, bank, doc],
    build: async (v, ctx) => ({ description: "Bankkosten", lines: [{ account_code: "650", debit: +v.amount }, { account_code: await ctx.bankCodeFor(v.bank_account_id), credit: +v.amount }] }),
  },
  {
    code: "transfer", name: "Overboeking tussen rekeningen", group: "Bank", description: "Bv. van werkkapitaal naar reservekapitaal of naar een termijnrekening.",
    fields: [date, amount, { key: "from_bank", label: "Van rekening", type: "bank", required: true }, { key: "to_code", label: "Naar rekening (5xx)", type: "account", filter: "5", required: true }, doc],
    build: async (v, ctx) => ({ description: "Interne overboeking", lines: [{ account_code: v.to_code, debit: +v.amount }, { account_code: await ctx.bankCodeFor(v.from_bank), credit: +v.amount }] }),
  },
  {
    code: "other_income", name: "Andere opbrengst", group: "Opbrengsten", description: "Bv. huur van gemene delen, recuperatie van kosten, verzekeringsuitkering.",
    fields: [date, { key: "counterparty", label: "Tegenpartij", type: "text" }, amount, { key: "income_code", label: "Opbrengstrekening", type: "account", filter: "7", default: "740", required: true }, bank, doc],
    build: async (v, ctx) => ({ description: `Opbrengst ${v.counterparty || ""}`.trim(), counterparty: v.counterparty, lines: [{ account_code: await ctx.bankCodeFor(v.bank_account_id), debit: +v.amount }, { account_code: v.income_code, credit: +v.amount }] }),
  },
  {
    code: "credit_note", name: "Creditnota leverancier", group: "Kosten", description: "Vermindering van een eerder geboekte kost.",
    fields: [date, { key: "counterparty", label: "Leverancier", type: "text", required: true }, amount, { key: "expense_code", label: "Kostenrekening", type: "account", filter: "6", required: true }, doc],
    build: (v) => ({ description: `Creditnota ${v.counterparty}`, counterparty: v.counterparty, lines: [{ account_code: "440", debit: +v.amount }, { account_code: v.expense_code, credit: +v.amount }] }),
  },
  {
    code: "manual", name: "Vrije journaalpost", group: "Overig", description: "Eigen lijnen, debet en credit moeten gelijk zijn.",
    fields: [date, { key: "description", label: "Omschrijving", type: "text", required: true }, doc],
    build: (v) => ({ description: v.description, lines: v.lines ?? [] }),
  },
];

export const templateByCode = (code: string) => TEMPLATES.find((t) => t.code === code);

// ---------- CSV-import bank ----------
export interface BankTxInput { date: string; amount: number; counterparty_name?: string | null; counterparty_iban?: string | null; communication?: string | null; structured_ref?: string | null; external_ref?: string | null; statement_no?: string | null }

function parseCsvRows(text: string): string[][] {
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) >= (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some((c) => c.trim())) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some((c) => c.trim())) rows.push(row); }
  return rows;
}
const parseAmount = (s: string) => { const t = s.replace(/\s|€/g, ""); const n = t.includes(",") && (!t.includes(".") || t.lastIndexOf(",") > t.lastIndexOf(".")) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""); const v = parseFloat(n); return isNaN(v) ? null : v; };
const parseDate = (s: string) => { const t = s.trim(); let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return null; };

/** Herkent kolommen van Belgische bank-CSV's (KBC, Belfius, BNP Paribas Fortis, ING, Argenta, Crelan) op basis van de kopregel. */
export function parseBankCsv(text: string, mapping?: Record<string, number>): { rows: BankTxInput[]; headers: string[]; detected: Record<string, number> } {
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new HttpError(400, "CSV bevat geen gegevens");
  const headers = rows[0].map((h) => h.trim());
  // kandidaten in volgorde van voorkeur; de eerste regex die ergens matcht wint
  const find = (...names: RegExp[]) => { for (const n of names) { const i = headers.findIndex((h) => n.test(h.toLowerCase())); if (i >= 0) return i; } return -1; };
  const det: Record<string, number> = mapping ?? {
    date: find(/^(boekingsdatum|datum|date|uitvoeringsdatum)$/, /^(boekingsdatum|datum|date)/, /valutadatum/),
    amount: find(/^(bedrag|amount|montant)$/, /^(bedrag|amount|montant)/),
    counterparty_name: find(/naam tegenpartij|naam van de tegenpartij|counterparty name|begunstigde/, /^tegenpartij$/, /tegenpartij naam/),
    counterparty_iban: find(/rekeningnummer tegenpartij|rekening tegenpartij|iban tegenpartij|tegenrekening|counterparty account|iban/),
    communication: find(/vrije mededeling/, /^mededeling/, /^communication/, /details/),
    description: find(/omschrijving|^description/),
    structured_ref: find(/gestructureerde mededeling|structured/),
    external_ref: find(/^(referentie|reference|volgnummer|transactienummer|transaction id|ref\.?)$/, /referentie|reference|volgnummer|transactie/),
  };
  if (det.date < 0 || det.amount < 0) return { rows: [], headers, detected: det };
  const out: BankTxInput[] = [];
  for (const r of rows.slice(1)) {
    const d = parseDate(r[det.date] ?? ""); const a = parseAmount(r[det.amount] ?? "");
    if (!d || a === null) continue;
    const comm = [det.communication >= 0 ? r[det.communication] : "", det.description >= 0 ? r[det.description] : ""].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ") || null;
    const sref = det.structured_ref >= 0 ? ogmDigits(r[det.structured_ref]) : ogmDigits((comm ?? "").match(/\+{3}\d{3}\/\d{4}\/\d{5}\+{3}|\*{3}\d{3}\/\d{4}\/\d{5}\*{3}/)?.[0]);
    out.push({ date: d, amount: a, counterparty_name: det.counterparty_name >= 0 ? r[det.counterparty_name]?.trim() : null, counterparty_iban: det.counterparty_iban >= 0 ? r[det.counterparty_iban]?.replace(/\s/g, "") : null, communication: comm?.trim() || null, structured_ref: sref && ogmValid(sref) ? sref : null, external_ref: det.external_ref >= 0 && r[det.external_ref] ? r[det.external_ref].trim() : `${d}|${a}|${(comm ?? "").slice(0, 40)}` });
  }
  return { rows: out, headers, detected: det };
}

// ---------- CODA-import (Febelfin CODA 2.x, vaste breedte 128 tekens) ----------
const codaAmount = (s: string) => parseInt(s, 10) / 1000;
const codaDate = (s: string) => `20${s.slice(4, 6)}-${s.slice(2, 4)}-${s.slice(0, 2)}`; // DDMMYY
export interface CodaResult { account: string | null; statement_no: string | null; old_balance: number | null; new_balance: number | null; rows: BankTxInput[] }

export function parseCoda(text: string): CodaResult {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 1);
  const res: CodaResult = { account: null, statement_no: null, old_balance: null, new_balance: null, rows: [] };
  let cur: (BankTxInput & { _info?: string }) | null = null;
  const flush = () => { if (cur) { if (!cur.structured_ref) { const d = ogmDigits((cur.communication ?? "").match(/\d{3}\/?\d{4}\/?\d{5}/)?.[0]); if (d && ogmValid(d)) cur.structured_ref = d; } res.rows.push(cur); cur = null; } };
  for (const l of lines) {
    const t = l[0];
    if (t === "1") { res.statement_no = l.slice(2, 5).trim(); res.account = l.slice(5, 42).trim().split(" ")[0]; const sign = l[42] === "1" ? -1 : 1; res.old_balance = sign * codaAmount(l.slice(43, 58)); }
    else if (t === "2") {
      const sub = l[1];
      if (sub === "1") {
        flush();
        const sign = l[31] === "1" ? -1 : 1;
        const structured = l[61] === "1";
        const comm = l.slice(62, 115);
        cur = { date: codaDate(l.slice(115, 121)), amount: sign * codaAmount(l.slice(32, 47)), external_ref: l.slice(2, 10).trim() + ":" + l.slice(10, 31).trim(), statement_no: l.slice(124, 127).trim() || res.statement_no, communication: structured ? null : comm.trim(), structured_ref: structured && comm.slice(0, 3) === "101" ? comm.slice(3, 15) : null };
      } else if (sub === "2" && cur) { cur.communication = ((cur.communication ?? "") + " " + l.slice(10, 63).trim()).trim(); }
      else if (sub === "3" && cur) { cur.counterparty_iban = l.slice(10, 47).trim().split(" ")[0] || null; cur.counterparty_name = l.slice(47, 82).trim() || null; const extra = l.slice(82, 125).trim(); if (extra && !cur.communication) cur.communication = extra; }
    }
    else if (t === "3" && cur) { const sub = l[1]; if (sub === "1") { const structured = l[39] === "1"; const info = l.slice(40, 113); if (structured && info.slice(0, 3) === "101" && !cur.structured_ref) cur.structured_ref = info.slice(3, 15); else if (!structured) cur.communication = ((cur.communication ?? "") + " " + info.trim()).trim(); if (!cur.counterparty_name && info.slice(0, 3) === "001") cur.counterparty_name = info.slice(3, 73).trim() || null; } else if (sub === "2" || sub === "3") { cur.communication = ((cur.communication ?? "") + " " + l.slice(10, 115).trim()).trim(); } }
    else if (t === "8") { const sign = l[41] === "1" ? -1 : 1; res.new_balance = sign * codaAmount(l.slice(42, 57)); }
  }
  flush();
  for (const r of res.rows) if (r.structured_ref && !ogmValid(r.structured_ref)) r.structured_ref = null;
  return res;
}
