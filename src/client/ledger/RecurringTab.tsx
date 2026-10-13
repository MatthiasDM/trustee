import { useState, type FormEvent } from "react";
import { Play, Plus, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { AccountSelect, Money, NONE, type Account, type BankAccount, type CostKey } from "./shared";

const FREQ: Record<string, string> = { monthly: "Maandelijks", quarterly: "Per kwartaal", halfyearly: "Halfjaarlijks", yearly: "Jaarlijks" };
const TEMPLATES = [["direct_expense", "Kost via bank (domiciliëring, ereloon, verzekering)"], ["supplier_invoice", "Factuur leverancier (schuld op 440)"], ["bank_fee", "Bankkosten"], ["transfer", "Overboeking naar reservekapitaal / spaarrekening"]];

/** Periodieke boekingen: terugkerende kosten die de cron automatisch boekt op de vervaldag. */
export function RecurringTab({ accounts, banks, keys }: { accounts: Account[]; banks: BankAccount[]; keys: CostKey[] }) {
  const b = useBuilding();
  const { data, reload } = useFetch<any[]>(`/api/buildings/${b.id}/ledger/recurring`);
  const [open, setOpen] = useState(false);
  return <div>
    <div className="mb-4 flex items-start justify-between gap-3"><p className="text-sm text-muted-foreground">Terugkerende kosten (ereloon syndicus, verzekering, onderhoudscontract, overboeking naar het reservekapitaal) worden automatisch geboekt op de volgende datum; je koppelt het verantwoordingsstuk achteraf via het dagboek.</p>{b.isManager && <Button onClick={() => setOpen(true)}><Plus />Periodieke boeking</Button>}</div>
    {!data?.length ? <Empty icon={<Repeat />} title="Nog geen periodieke boekingen" /> : <div className="divide-y rounded-xl border bg-card shadow-xs">{data.map((r) => <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${!r.active ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{FREQ[r.frequency]} · {TEMPLATES.find((t) => t[0] === r.template_code)?.[1] ?? r.template_code}{r.params.counterparty ? ` · ${r.params.counterparty}` : ""}{r.params.expense_code ? ` · ${r.params.expense_code}` : ""}{r.end_date ? ` · tot ${fmtDate(r.end_date)}` : ""}{r.last_run ? ` · laatst ${fmtDate(r.last_run)}` : ""}</div></div>
      <Money n={+r.params.amount || 0} className="font-medium" /><Badge variant={r.active ? "info" : "outline"}>volgende {fmtDate(r.next_date)}</Badge>
      {b.isManager && <><Switch checked={!!r.active} onCheckedChange={async (v) => { await api.patch(`/api/buildings/${b.id}/ledger/recurring/${r.id}`, { active: v }); reload(); }} /><Button size="sm" variant="outline" onClick={async () => { await api.post(`/api/buildings/${b.id}/ledger/recurring/${r.id}/run`); toast.success("Geboekt"); reload(); }}><Play />Nu boeken</Button><Button size="icon-sm" variant="ghost" onClick={async () => { if (confirm("Verwijderen?")) { await api.del(`/api/buildings/${b.id}/ledger/recurring/${r.id}`); reload(); } }}><Trash2 /></Button></>}
    </div>)}</div>}
    {open && <RecurringDialog accounts={accounts} banks={banks} keys={keys} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
  </div>;
}

function RecurringDialog({ accounts, banks, keys, onClose, onDone }: { accounts: Account[]; banks: BankAccount[]; keys: CostKey[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ name: "", template_code: "direct_expense", frequency: "monthly", next_date: new Date().toISOString().slice(0, 10), end_date: "", counterparty: "", amount: "", expense_code: "", cost_key_id: "", bank_account_id: banks[0]?.id ?? "", from_bank: banks[0]?.id ?? "", to_code: "550", fund: "working" });
  const [error, setError] = useState<unknown>(null);
  const t = f.template_code;
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Periodieke boeking</DialogTitle><DialogDescription>Wordt automatisch geboekt op de volgende datum en daarna volgens de frequentie.</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); const params: any = { amount: +f.amount, counterparty: f.counterparty }; if (t === "direct_expense") Object.assign(params, { expense_code: f.expense_code, cost_key_id: f.cost_key_id || null, bank_account_id: f.bank_account_id }); if (t === "supplier_invoice") Object.assign(params, { expense_code: f.expense_code, cost_key_id: f.cost_key_id || null, fund: f.fund }); if (t === "bank_fee") Object.assign(params, { bank_account_id: f.bank_account_id }); if (t === "transfer") Object.assign(params, { from_bank: f.from_bank, to_code: f.to_code }); try { await api.post(`/api/buildings/${b.id}/ledger/recurring`, { name: f.name, template_code: t, params, frequency: f.frequency, next_date: f.next_date, end_date: f.end_date || null }); toast.success("Periodieke boeking aangemaakt"); onDone(); } catch (err) { setError(err); } }}>
      <Field label="Naam"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="bv. Ereloon syndicus" /></Field>
      <Field label="Soort"><Select value={t} onValueChange={(v) => setF({ ...f, template_code: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TEMPLATES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Bedrag (€)"><Input type="number" step="0.01" min="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>{t !== "transfer" && t !== "bank_fee" && <Field label="Tegenpartij"><Input required value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} /></Field>}</div>
      {(t === "direct_expense" || t === "supplier_invoice") && <div className="grid grid-cols-2 gap-3"><Field label="Kostenrekening"><AccountSelect accounts={accounts} filter="6" value={f.expense_code} onChange={(v) => setF({ ...f, expense_code: v })} /></Field><Field label="Verdeelsleutel"><Select value={f.cost_key_id || NONE} onValueChange={(v) => setF({ ...f, cost_key_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Standaard (aandelen)</SelectItem>{keys.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></Field></div>}
      {(t === "direct_expense" || t === "bank_fee") && <Field label="Bankrekening"><Select value={f.bank_account_id} onValueChange={(v) => setF({ ...f, bank_account_id: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{banks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></Field>}
      {t === "transfer" && <div className="grid grid-cols-2 gap-3"><Field label="Van rekening"><Select value={f.from_bank} onValueChange={(v) => setF({ ...f, from_bank: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{banks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Naar rekening (5xx)"><AccountSelect accounts={accounts} filter="5" value={f.to_code} onChange={(v) => setF({ ...f, to_code: v })} /></Field></div>}
      <div className="grid grid-cols-3 gap-3"><Field label="Frequentie"><Select value={f.frequency} onValueChange={(v) => setF({ ...f, frequency: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(FREQ).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field><Field label="Eerste boeking"><Input type="date" required value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></Field><Field label="Tot (optioneel)"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field></div>
      <ErrorBox error={error} /><DialogFooter><Button>Aanmaken</Button></DialogFooter></form></DialogContent></Dialog>;
}
