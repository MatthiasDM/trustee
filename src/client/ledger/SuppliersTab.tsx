import { useState, type FormEvent } from "react";
import { Building, Mail, Phone, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { AccountSelect, Money, NONE, type Account, type CostKey } from "./shared";

export interface Supplier { id: string; name: string; category?: string | null; iban?: string | null; vat?: string | null; email?: string | null; phone?: string | null; address?: string | null; default_account_code?: string | null; default_account_name?: string | null; default_cost_key_id?: string | null; contract_until?: string | null; notes?: string | null; active: number; open_tickets: number; spent_12m: number }
const CATS = ["lift", "verwarming", "elektriciteit", "sanitair", "schoonmaak", "tuin", "brandbeveiliging", "verzekering", "aannemer", "syndicus", "overig"];

export function SuppliersTab({ accounts, keys }: { accounts: Account[]; keys: CostKey[] }) {
  const b = useBuilding();
  const { data, reload } = useFetch<Supplier[]>(`/api/buildings/${b.id}/suppliers`);
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  const list = data ?? [];
  return <div>
    <div className="mb-4 flex items-start justify-between gap-3"><p className="text-sm text-muted-foreground">Adresboek van de VME. Een standaardrekening en verdeelsleutel per leverancier maken het boeken en de bankmatching sneller; meldingen kunnen aan een leverancier toegewezen worden.</p>{b.isManager && <Button onClick={() => setEdit("new")}><Plus />Leverancier</Button>}</div>
    {!list.length ? <Empty icon={<Building />} title="Nog geen leveranciers" /> : <div className="divide-y rounded-xl border bg-card shadow-xs">{list.map((s) => <div key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${!s.active ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1"><div className="font-medium">{s.name} {s.category && <Badge variant="secondary">{s.category}</Badge>}{!s.active && <Badge variant="outline">inactief</Badge>}</div><div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{s.iban && <span>{s.iban}</span>}{s.email && <span className="flex items-center gap-1"><Mail className="size-3" />{s.email}</span>}{s.phone && <span className="flex items-center gap-1"><Phone className="size-3" />{s.phone}</span>}{s.default_account_code && <span>standaard {s.default_account_code} {s.default_account_name}</span>}{s.contract_until && <span>contract tot {fmtDate(s.contract_until)}</span>}</div></div>
      <div className="text-right text-xs text-muted-foreground"><div>12 mnd: <Money n={s.spent_12m} /></div>{s.open_tickets > 0 && <Badge variant="warning">{s.open_tickets} open melding(en)</Badge>}</div>
      {b.isManager && <Button size="icon-sm" variant="ghost" onClick={() => setEdit(s)}><Pencil /></Button>}</div>)}</div>}
    {edit && <SupplierDialog supplier={edit === "new" ? null : edit} accounts={accounts} keys={keys} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
  </div>;
}

function SupplierDialog({ supplier, accounts, keys, onClose, onDone }: { supplier: Supplier | null; accounts: Account[]; keys: CostKey[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ name: supplier?.name ?? "", category: supplier?.category ?? "overig", iban: supplier?.iban ?? "", vat: supplier?.vat ?? "", email: supplier?.email ?? "", phone: supplier?.phone ?? "", address: supplier?.address ?? "", default_account_code: supplier?.default_account_code ?? "", default_cost_key_id: supplier?.default_cost_key_id ?? "", contract_until: supplier?.contract_until ?? "", notes: supplier?.notes ?? "", active: supplier ? !!supplier.active : true });
  const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{supplier ? supplier.name : "Nieuwe leverancier"}</DialogTitle></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); const body = { ...f, iban: f.iban || null, vat: f.vat || null, email: f.email || null, phone: f.phone || null, address: f.address || null, default_account_code: f.default_account_code || null, default_cost_key_id: f.default_cost_key_id || null, contract_until: f.contract_until || null, notes: f.notes || null }; try { if (supplier) await api.patch(`/api/buildings/${b.id}/suppliers/${supplier.id}`, body); else await api.post(`/api/buildings/${b.id}/suppliers`, body); toast.success("Leverancier bewaard"); onDone(); } catch (err) { setError(err); } }}>
      <div className="grid grid-cols-3 gap-3"><Field label="Naam" className="col-span-2"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Categorie"><Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="IBAN" hint="Voor automatische herkenning van bankverrichtingen"><Input value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} /></Field><Field label="Btw-nummer"><Input value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Telefoon"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
      <Field label="Adres"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Standaard kostenrekening"><AccountSelect accounts={accounts} filter="6" value={f.default_account_code} onChange={(v) => setF({ ...f, default_account_code: v })} /></Field><Field label="Standaard verdeelsleutel"><Select value={f.default_cost_key_id || NONE} onValueChange={(v) => setF({ ...f, default_cost_key_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Standaard (aandelen)</SelectItem>{keys.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Contract tot"><Input type="date" value={f.contract_until} onChange={(e) => setF({ ...f, contract_until: e.target.value })} /></Field>{supplier && <Field label="Status"><Select value={f.active ? "1" : "0"} onValueChange={(v) => setF({ ...f, active: v === "1" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Actief</SelectItem><SelectItem value="0">Inactief</SelectItem></SelectContent></Select></Field>}</div>
      <Field label="Notities"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <ErrorBox error={error} /><DialogFooter><Button>Bewaren</Button></DialogFooter></form></DialogContent></Dialog>;
}
