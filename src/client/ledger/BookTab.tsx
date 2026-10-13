import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { ErrorBox, Field, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api } from "../lib/api";
import { AccountSelect, NONE, type Account, type BankAccount, type CostKey } from "./shared";
import { DocumentPicker } from "./DocumentPicker";
import type { Unit } from "../../shared/types";

interface TemplateField { key: string; label: string; type: string; required?: boolean; default?: string; filter?: string; hint?: string }
interface Template { code: string; name: string; group: string; description: string; fields: TemplateField[] }

/** "Handelingen": sjablonen die de juiste debet- en creditrekeningen invullen. */
export function BookTab({ accounts, banks, keys, onPosted }: { accounts: Account[]; banks: BankAccount[]; keys: CostKey[]; onPosted: () => void }) {
  const b = useBuilding();
  const templates = useFetch<Template[]>(`/api/buildings/${b.id}/ledger/templates`);
  const units = useFetch<{ units: Unit[] }>(`/api/buildings/${b.id}/units`);
  const [sel, setSel] = useState<Template | null>(null);
  const [v, setV] = useState<Record<string, any>>({});
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  if (templates.loading || !templates.data) return <Spinner />;
  const groups = [...new Set(templates.data.filter((t) => t.code !== "manual").map((t) => t.group))];
  const pick = (t: Template) => { setSel(t); setError(null); const init: Record<string, any> = { date: new Date().toISOString().slice(0, 10) }; for (const f of t.fields) if (f.default) init[f.key] = f.default; if (banks[0]) for (const f of t.fields) if (f.type === "bank") init[f.key] = banks[0].id; setV(init); };
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!sel) return; setBusy(true); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/templates/${sel.code}/post`, { ...v, amount: v.amount ? +v.amount : undefined }); toast.success(`${sel.name} geboekt`); setV({ ...v, amount: "", counterparty: "", document_id: "" }); onPosted(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const field = (f: TemplateField) => {
    const set = (val: any) => setV({ ...v, [f.key]: val });
    switch (f.type) {
      case "amount": return <Input type="number" step="0.01" min="0.01" required={f.required} value={v[f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
      case "date": return <Input type="date" required={f.required} value={v[f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
      case "text": return <Input required={f.required} value={v[f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
      case "account": return <AccountSelect accounts={accounts} filter={f.filter} value={v[f.key] ?? ""} onChange={set} />;
      case "unit": return <Select value={v[f.key] ?? NONE} onValueChange={(x) => set(x === NONE ? "" : x)}><SelectTrigger className="w-full"><SelectValue placeholder="Kavel" /></SelectTrigger><SelectContent><SelectItem value={NONE}>— kavel —</SelectItem>{(units.data?.units ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.label}{u.owners?.length ? ` · ${u.owners.map((o) => o.name).join(", ")}` : ""}</SelectItem>)}</SelectContent></Select>;
      case "cost_key": return <Select value={v[f.key] ?? NONE} onValueChange={(x) => set(x === NONE ? "" : x)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Standaard (volgens aandelen)</SelectItem>{keys.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select>;
      case "fund": return <Select value={v[f.key] ?? "working"} onValueChange={set}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="working">Werkkapitaal (gewone kosten)</SelectItem><SelectItem value="reserve">Reservekapitaal (buitengewone kosten)</SelectItem></SelectContent></Select>;
      case "bank": return <Select value={v[f.key] ?? NONE} onValueChange={(x) => set(x === NONE ? "" : x)}><SelectTrigger className="w-full"><SelectValue placeholder="Bankrekening" /></SelectTrigger><SelectContent>{!banks.length && <SelectItem value={NONE}>Geen bankrekening: maak er een aan onder Instellingen</SelectItem>}{banks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name} ({k.fund === "reserve" ? "reserve" : "werk"})</SelectItem>)}</SelectContent></Select>;
      case "document": return <DocumentPicker value={v[f.key] ?? ""} onChange={(id) => set(id)} suggestedName={v.counterparty ? `${sel?.name} ${v.counterparty}` : undefined} />;
      default: return <Input value={v[f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
    }
  };
  return <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
    <div className="space-y-4">{groups.map((g) => <div key={g}><div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{g}</div><div className="grid gap-1">{templates.data!.filter((t) => t.group === g && t.code !== "manual").map((t) => <button key={t.code} className={`rounded-lg border px-3 py-2 text-left text-sm transition cursor-pointer ${sel?.code === t.code ? "border-primary bg-primary/5" : "hover:bg-accent"}`} onClick={() => pick(t)}><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.description}</div></button>)}</div></div>)}</div>
    <div className="rounded-xl border bg-card p-5 shadow-xs">{!sel ? <p className="text-sm text-muted-foreground">Kies links een handeling. Trustee vult de juiste rekeningen aan debet- en creditzijde in; jij geeft enkel bedrag, datum en tegenpartij.</p> :
      <form onSubmit={submit} className="grid gap-4"><div><h3 className="font-semibold">{sel.name}</h3><p className="text-sm text-muted-foreground">{sel.description}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">{sel.fields.map((f) => <Field key={f.key} label={f.label} hint={f.hint} className={f.type === "text" || f.type === "document" ? "sm:col-span-2" : ""}>{field(f)}</Field>)}</div>
        <Field label="Extra omschrijving (optioneel)"><Input value={v.memo ?? ""} onChange={(e) => setV({ ...v, memo: e.target.value })} /></Field>
        <ErrorBox error={error} /><div className="flex justify-end"><Button disabled={busy}>Boeken</Button></div></form>}</div>
  </div>;
}
