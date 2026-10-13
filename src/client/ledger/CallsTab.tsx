import { useState, type FormEvent } from "react";
import { Copy, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { Money, NONE, type CostKey } from "./shared";

/** Oproepen van voorschotten (werk- en reservekapitaal) met gestructureerde mededeling per kavel. */
export function CallsTab({ keys, onPosted }: { keys: CostKey[]; onPosted: () => void }) {
  const b = useBuilding();
  const calls = useFetch<any[]>(`/api/buildings/${b.id}/ledger/calls`);
  const [open, setOpen] = useState(false);
  return <div>
    <div className="mb-4 flex items-start justify-between gap-3"><p className="text-sm text-muted-foreground">Elke oproep boekt een vordering per kavel (410) tegenover de voorschotten (700/701). Eigenaars betalen met de gestructureerde mededeling; bankverrichtingen worden dan automatisch herkend.</p>{b.isManager && <Button onClick={() => setOpen(true)}><Plus />Oproep</Button>}</div>
    {calls.loading ? <Spinner /> : !calls.data?.length ? <Empty icon={<Receipt />} title="Nog geen oproepen" /> :
      <div className="space-y-3">{calls.data.map((c) => <div key={c.id} className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">{c.description}</div><div className="text-xs text-muted-foreground">{fmtDate(c.date)}{c.due_date ? ` · te betalen vóór ${fmtDate(c.due_date)}` : ""} · {c.cost_key_name ?? "volgens aandelen"}</div></div><div className="flex items-center gap-2"><Badge variant={c.fund === "reserve" ? "violet" : "info"}>{c.fund === "reserve" ? "Reservekapitaal" : "Werkkapitaal"}</Badge><Money n={c.total} className="font-semibold" /></div></div>
        <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Kavel</th><th className="py-1 text-right">Bedrag</th><th className="py-1 pl-4">Gestructureerde mededeling</th></tr></thead><tbody>{c.lines.map((l: any) => <tr key={l.id} className="border-t"><td className="py-1">{l.label}</td><td className="py-1 text-right tabular-nums">{l.amount.toFixed(2)}</td><td className="py-1 pl-4 font-mono text-xs"><button className="inline-flex items-center gap-1 hover:text-primary cursor-pointer" onClick={() => { navigator.clipboard?.writeText(l.ogm); toast.success("Gekopieerd"); }}>{l.ogm}<Copy className="size-3" /></button></td></tr>)}</tbody></table>
      </div>)}</div>}
    {open && <CallDialog keys={keys} onClose={() => setOpen(false)} onDone={() => { setOpen(false); calls.reload(); onPosted(); }} />}
  </div>;
}

function CallDialog({ keys, onClose, onDone }: { keys: CostKey[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ fund: "working", date: new Date().toISOString().slice(0, 10), due_date: "", description: "", total: "", cost_key_id: "", notify: true }); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Voorschotten oproepen</DialogTitle><DialogDescription>Het totaal wordt verdeeld over de kavels volgens de gekozen sleutel. Elke eigenaar krijgt een melding met zijn bedrag en gestructureerde mededeling.</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/calls`, { ...f, total: +f.total, due_date: f.due_date || null, cost_key_id: f.cost_key_id || null }); toast.success("Oproep geboekt en verstuurd"); onDone(); } catch (err) { setError(err); } }}>
      <Field label="Fonds"><Select value={f.fund} onValueChange={(v) => setF({ ...f, fund: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="working">Werkkapitaal (gewone kosten)</SelectItem><SelectItem value="reserve">Reservekapitaal (buitengewone kosten)</SelectItem></SelectContent></Select></Field>
      <Field label="Omschrijving"><Input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="bv. Voorschot 1e semester 2026" /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label="Totaal (€)"><Input type="number" step="0.01" min="0.01" required value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field><Field label="Datum"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label="Vervaldag"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field></div>
      <Field label="Verdeelsleutel"><Select value={f.cost_key_id || NONE} onValueChange={(v) => setF({ ...f, cost_key_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Standaard (volgens aandelen)</SelectItem>{keys.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></Field>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.notify} onCheckedChange={(v) => setF({ ...f, notify: !!v })} />Eigenaars verwittigen (push + e-mail)</label>
      <ErrorBox error={error} /><DialogFooter><Button>Oproep boeken</Button></DialogFooter></form></DialogContent></Dialog>;
}
