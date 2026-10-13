import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { Empty, ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, fmtDate } from "../lib/api";
import { DocumentPicker } from "../ledger/DocumentPicker";

const NONE = "__none__";

/** Keuringsattesten en periodieke controles met vervaldata en herinneringen. */
export function ComplianceTab() {
  const b = useBuilding();
  const { data, reload } = useFetch<{ items: any[]; kinds: Record<string, { label: string; months: number; basis: string }> }>(`/api/buildings/${b.id}/compliance`);
  const suppliers = useFetch<any[]>(`/api/buildings/${b.id}/suppliers`);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  if (!data) return null;
  return <div>
    <div className="mb-4 flex items-start justify-between gap-3"><p className="text-sm text-muted-foreground">Liftkeuring, brandblussers, elektrische keuring, verwarmingsonderhoud, EPC, asbestattest, verzekeringen: één lijst met de volgende vervaldag. Syndicus en raad krijgen 60 dagen vooraf en bij overschrijding een melding. Registreer de nieuwe keuring met het attest als document.</p>{b.isBoard && <Button onClick={() => setEdit("new")}><Plus />Keuring</Button>}</div>
    {!data.items.length ? <Empty icon={<ShieldCheck />} title="Nog geen keuringen geregistreerd" /> : <div className="divide-y rounded-xl border bg-card shadow-xs">{data.items.map((x) => <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      {x.state === "overdue" ? <AlertTriangle className="size-5 text-destructive" /> : x.state === "soon" ? <Clock className="size-5 text-amber-600" /> : <CheckCircle2 className="size-5 text-emerald-600" />}
      <div className="min-w-0 flex-1"><div className="font-medium">{x.title} <Badge variant="secondary">{data.kinds[x.kind]?.label ?? x.kind}</Badge></div><div className="text-xs text-muted-foreground">{x.last_date ? `laatste ${fmtDate(x.last_date)} · ` : ""}om de {x.interval_months} maanden{x.supplier_name ? ` · ${x.supplier_name}` : ""}{x.document_name ? ` · attest: ${x.document_name}` : ""}{x.notes ? ` · ${x.notes}` : ""}</div></div>
      <Badge variant={x.state === "overdue" ? "red" : x.state === "soon" ? "warning" : "success"}>{x.state === "overdue" ? `${-x.days_left} d vervallen` : `vervalt ${fmtDate(x.next_date)}`}</Badge>
      {b.isBoard && <Button size="sm" variant="outline" onClick={() => setEdit(x)}>Bewerken / nieuwe keuring</Button>}{b.isManager && <Button size="icon-sm" variant="ghost" onClick={async () => { if (confirm("Verwijderen?")) { await api.del(`/api/buildings/${b.id}/compliance/${x.id}`); reload(); } }}><Trash2 /></Button>}
    </div>)}</div>}
    {edit && <ComplianceDialog item={edit === "new" ? null : edit} kinds={data.kinds} suppliers={suppliers.data ?? []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
  </div>;
}

function ComplianceDialog({ item, kinds, suppliers, onClose, onDone }: { item: any; kinds: Record<string, { label: string; months: number; basis: string }>; suppliers: any[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ kind: item?.kind ?? "lift", title: item?.title ?? kinds.lift?.label ?? "", supplier_id: item?.supplier_id ?? "", last_date: item?.last_date ?? "", interval_months: String(item?.interval_months ?? kinds.lift?.months ?? 12), next_date: item?.next_date ?? "", document_id: item?.document_id ?? "", notes: item?.notes ?? "" });
  const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>{item ? "Keuring bijwerken" : "Keuring registreren"}</DialogTitle><DialogDescription>{kinds[f.kind]?.basis}</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); const body = { ...f, interval_months: +f.interval_months, supplier_id: f.supplier_id || null, last_date: f.last_date || null, next_date: f.next_date || undefined, document_id: f.document_id || null, notes: f.notes || null }; try { if (item) await api.patch(`/api/buildings/${b.id}/compliance/${item.id}`, body); else await api.post(`/api/buildings/${b.id}/compliance`, body); toast.success("Bewaard"); onDone(); } catch (err) { setError(err); } }}>
      <div className="grid grid-cols-2 gap-3"><Field label="Soort"><Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v, title: item ? f.title : kinds[v].label, interval_months: String(kinds[v].months) })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kinds).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Interval (maanden)"><Input type="number" min={1} required value={f.interval_months} onChange={(e) => setF({ ...f, interval_months: e.target.value })} /></Field></div>
      <Field label="Omschrijving"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Laatste keuring" hint="De volgende vervaldag wordt hieruit berekend."><Input type="date" value={f.last_date} onChange={(e) => setF({ ...f, last_date: e.target.value, next_date: "" })} /></Field><Field label="Of: volgende vervaldag"><Input type="date" value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></Field></div>
      <Field label="Keuringsorganisme / leverancier"><Select value={f.supplier_id || NONE} onValueChange={(v) => setF({ ...f, supplier_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>—</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Attest / verslag"><DocumentPicker value={f.document_id} onChange={(id) => setF({ ...f, document_id: id })} suggestedName={f.title} /></Field>
      <Field label="Notities"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <ErrorBox error={error} /><DialogFooter><Button>Bewaren</Button></DialogFooter></form></DialogContent></Dialog>;
}
