import { useState, type FormEvent } from "react";
import { Check, Landmark, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { AccountSelect, Money, NONE, type Account, type BankAccount, type CostKey } from "./shared";
import { DocumentPicker } from "./DocumentPicker";
import type { Unit } from "../../shared/types";

const KINDS = [["owner_payment", "Bijdrage van mede-eigenaar"], ["supplier_payment", "Betaling leverancier (open factuur)"], ["direct_expense", "Kost rechtstreeks (zonder factuurboeking)"], ["bank_fee", "Bankkosten"], ["interest", "Interesten"], ["other_income", "Andere opbrengst"], ["transfer", "Overboeking tussen eigen rekeningen"], ["ignore", "Negeren (geen boeking)"]];

export function BankTab({ banks, accounts, keys, reloadBanks, onPosted }: { banks: BankAccount[]; accounts: Account[]; keys: CostKey[]; reloadBanks: () => void; onPosted: () => void }) {
  const b = useBuilding();
  const txs = useFetch<any[]>(`/api/buildings/${b.id}/ledger/bank-transactions`);
  const units = useFetch<{ units: Unit[] }>(`/api/buildings/${b.id}/units`);
  const [importFor, setImportFor] = useState<BankAccount | null>(null); const [manualFor, setManualFor] = useState<BankAccount | null>(null);
  const [match, setMatch] = useState<any>(null);
  const reload = () => { txs.reload(); reloadBanks(); onPosted(); };
  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2">{banks.map((k) => <div key={k.id} className="rounded-xl border bg-card p-4 shadow-xs"><div className="flex items-start justify-between gap-2"><div><div className="flex items-center gap-2 font-medium"><Landmark className="size-4 text-primary" />{k.name}</div><div className="text-xs text-muted-foreground">{k.iban ?? "geen IBAN"} · rekening {k.code} · {k.fund === "reserve" ? "reservekapitaal" : "werkkapitaal"}</div></div><Money n={k.balance} className="text-lg font-semibold" /></div>
      {b.isManager && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => setImportFor(k)}><Upload />Uittreksel importeren</Button><Button size="sm" variant="outline" onClick={() => setManualFor(k)}>Verrichting manueel</Button>{k.unmatched > 0 && <Badge variant="warning">{k.unmatched} te verwerken</Badge>}</div>}</div>)}
      {!banks.length && <p className="text-sm text-muted-foreground sm:col-span-2">Nog geen bankrekeningen. {b.isManager ? "Maak ze aan onder Instellingen (werk- en reservekapitaal apart, art. 3.86 §3 BW)." : ""}</p>}</div>
    <div><h3 className="mb-2 font-semibold">Te verwerken verrichtingen</h3>
      {txs.loading ? <Spinner /> : !txs.data?.length ? <Empty title="Alles is verwerkt" hint="Importeer een CSV- of CODA-uittreksel om nieuwe verrichtingen te koppelen." /> :
        <div className="divide-y rounded-xl border bg-card shadow-xs">{txs.data.map((t) => <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{fmtDate(t.date)}<br />{t.source.toUpperCase()}</span>
          <div className="min-w-0 flex-1"><div className="font-medium">{t.counterparty_name || "—"}</div><div className="truncate text-xs text-muted-foreground">{t.communication || (t.structured_ref ? `+++${t.structured_ref.slice(0, 3)}/${t.structured_ref.slice(3, 7)}/${t.structured_ref.slice(7)}+++` : "")}{t.counterparty_iban ? ` · ${t.counterparty_iban}` : ""}</div>{t.suggestion && <div className="mt-0.5 text-xs"><Badge variant={t.suggestion.confidence === "high" ? "success" : t.suggestion.confidence === "medium" ? "info" : "secondary"}>{KINDS.find((k) => k[0] === t.suggestion.kind)?.[1]}</Badge> <span className="text-muted-foreground">{t.suggestion.reason}</span></div>}</div>
          <Money n={t.amount} className="shrink-0 font-medium" />
          {b.isManager && <Button size="sm" onClick={() => setMatch(t)}>Verwerken</Button>}
        </div>)}</div>}</div>
    {importFor && <ImportDialog bank={importFor} onClose={() => setImportFor(null)} onDone={() => { setImportFor(null); reload(); }} />}
    {manualFor && <ManualTxDialog bank={manualFor} onClose={() => setManualFor(null)} onDone={() => { setManualFor(null); reload(); }} />}
    {match && <MatchDialog tx={match} accounts={accounts} keys={keys} units={units.data?.units ?? []} onClose={() => setMatch(null)} onDone={() => { setMatch(null); reload(); }} />}
  </div>;
}

function ImportDialog({ bank, onClose, onDone }: { bank: BankAccount; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [file, setFile] = useState<File | null>(null); const [result, setResult] = useState<any>(null); const [mapping, setMapping] = useState<Record<string, number>>({}); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!file) return; setBusy(true); setError(null); try { const fd = new FormData(); fd.append("file", file); if (result?.needs_mapping) fd.append("mapping", JSON.stringify({ ...result.detected, ...mapping })); const r = await api.upload<any>(`/api/buildings/${b.id}/ledger/bank-accounts/${bank.id}/import`, fd); setResult(r); if (!r.needs_mapping) { toast.success(`${r.inserted} nieuwe verrichting(en) geïmporteerd (${r.parsed} gelezen)`); onDone(); } } catch (err) { setError(err); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Uittreksel importeren: {bank.name}</DialogTitle><DialogDescription>CSV-export van je bank (KBC, Belfius, BNP Paribas Fortis, ING, Argenta, Crelan…) of een CODA-bestand. Reeds geïmporteerde verrichtingen worden overgeslagen.</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={submit}><Field label="Bestand (.csv of .cod)"><Input type="file" accept=".csv,.txt,.cod,.coda" required onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} /></Field>
      {result?.needs_mapping && <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p className="mb-2">De kolommen werden niet automatisch herkend. Kies ze hieronder.</p>{["date", "amount", "counterparty_name", "counterparty_iban", "communication"].map((k) => <Field key={k} label={{ date: "Datum", amount: "Bedrag", counterparty_name: "Naam tegenpartij", counterparty_iban: "IBAN tegenpartij", communication: "Mededeling" }[k]!} className="mb-2"><Select value={String(mapping[k] ?? result.detected[k] ?? -1)} onValueChange={(v) => setMapping({ ...mapping, [k]: +v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="-1">— niet aanwezig —</SelectItem>{result.headers.map((h: string, i: number) => <SelectItem key={i} value={String(i)}>{h || `(kolom ${i + 1})`}</SelectItem>)}</SelectContent></Select></Field>)}</div>}
      <ErrorBox error={error} /><DialogFooter><Button disabled={busy || !file}>{result?.needs_mapping ? "Importeren met deze kolommen" : "Importeren"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ManualTxDialog({ bank, onClose, onDone }: { bank: BankAccount; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", counterparty_name: "", counterparty_iban: "", communication: "" }); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Verrichting manueel toevoegen</DialogTitle><DialogDescription>Negatief bedrag = uitgave, positief = ontvangst. Daarna verwerk je ze zoals een geïmporteerde verrichting.</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/bank-accounts/${bank.id}/transactions`, { ...f, amount: +f.amount }); onDone(); } catch (err) { setError(err); } }}>
      <div className="grid grid-cols-2 gap-3"><Field label="Datum"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label="Bedrag"><Input type="number" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field></div>
      <Field label="Tegenpartij"><Input value={f.counterparty_name} onChange={(e) => setF({ ...f, counterparty_name: e.target.value })} /></Field><Field label="IBAN tegenpartij"><Input value={f.counterparty_iban} onChange={(e) => setF({ ...f, counterparty_iban: e.target.value })} /></Field><Field label="Mededeling"><Input value={f.communication} onChange={(e) => setF({ ...f, communication: e.target.value })} /></Field>
      <ErrorBox error={error} /><DialogFooter><Button>Toevoegen</Button></DialogFooter></form></DialogContent></Dialog>;
}

function MatchDialog({ tx, accounts, keys, units, onClose, onDone }: { tx: any; accounts: Account[]; keys: CostKey[]; units: Unit[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [kind, setKind] = useState(tx.suggestion?.kind ?? (tx.amount > 0 ? "owner_payment" : "direct_expense"));
  const [unit, setUnit] = useState(tx.suggestion?.unit_id ?? ""); const [code, setCode] = useState(tx.suggestion?.account_code ?? ""); const [key, setKey] = useState(tx.suggestion?.cost_key_id ?? ""); const [desc, setDesc] = useState(""); const [docId, setDocId] = useState(""); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Verrichting verwerken</DialogTitle><DialogDescription>{fmtDate(tx.date)} · {tx.counterparty_name || "—"} · <Money n={tx.amount} /><br />{tx.communication}</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/bank-transactions/${tx.id}/match`, { kind, unit_id: unit || undefined, account_code: code || undefined, cost_key_id: key || null, description: desc || undefined, document_id: docId || null }); toast.success(kind === "ignore" ? "Genegeerd" : "Geboekt"); onDone(); } catch (err) { setError(err); } }}>
      <Field label="Aard van de verrichting"><Select value={kind} onValueChange={setKind}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{KINDS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
      {kind === "owner_payment" && <Field label="Kavel"><Select value={unit || NONE} onValueChange={(v) => setUnit(v === NONE ? "" : v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>— kavel —</SelectItem>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.label}{u.owners?.length ? ` · ${u.owners.map((o) => o.name).join(", ")}` : ""}</SelectItem>)}</SelectContent></Select></Field>}
      {(kind === "direct_expense") && <><Field label="Kostenrekening"><AccountSelect accounts={accounts} filter="6" value={code} onChange={setCode} /></Field><Field label="Verdeelsleutel"><Select value={key || NONE} onValueChange={(v) => setKey(v === NONE ? "" : v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Standaard (aandelen)</SelectItem>{keys.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></Field></>}
      {kind === "other_income" && <Field label="Opbrengstrekening"><AccountSelect accounts={accounts} filter="7" value={code} onChange={setCode} /></Field>}
      {kind === "transfer" && <Field label="Tegenrekening (5xx)"><AccountSelect accounts={accounts} filter="5" value={code} onChange={setCode} /></Field>}
      {kind !== "ignore" && <Field label="Omschrijving (optioneel)"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>}
      {kind !== "ignore" && <Field label="Verantwoordingsstuk" hint="Bij een betaling van een open factuur zit het stuk al bij de factuurboeking; hier kan je het bankuittreksel of een bon koppelen."><DocumentPicker value={docId} onChange={setDocId} suggestedName={tx.counterparty_name ?? undefined} /></Field>}
      <ErrorBox error={error} /><DialogFooter><Button variant={kind === "ignore" ? "outline" : "default"}>{kind === "ignore" ? <><X />Negeren</> : <><Check />Boeken</>}</Button></DialogFooter></form></DialogContent></Dialog>;
}
