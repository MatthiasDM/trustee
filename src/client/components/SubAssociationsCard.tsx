import { useState } from "react";
import { Link } from "react-router-dom";
import { Network, Plus } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DocumentPicker } from "../ledger/DocumentPicker";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Unit } from "../../shared/types";

const NONE = "__none__";

/** Deelverenigingen (art. 3.84 BW): overzicht en oprichting vanuit de hoofdvereniging; in een deelvereniging de koppeling naar de hoofdvereniging. */
export function SubAssociationsCard() {
  const b = useBuilding(); const { refresh } = useAuth();
  const { data, reload } = useFetch<any>(`/api/buildings/${b.id}/sub-associations`);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  if (data.parent) return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Network className="size-4" />Deelvereniging</CardTitle><CardDescription>Deze VME is een deelvereniging van <Link className="underline" to={`/b/${data.parent.id}`}>{data.parent.name}</Link> en is enkel bevoegd voor: {data.parent.scope}. De hoofdvereniging blijft exclusief bevoegd voor de algemeen gemeenschappelijke delen en het gemeenschappelijk beheer (art. 3.84 BW). Eigenaars, lasthebbers en verkopen worden overgenomen uit de hoofdvereniging.</CardDescription></CardHeader></Card>;
  if (!data.children.length && !data.allowed && !b.isManager) return null;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Network className="size-4" />Deelverenigingen</CardTitle><CardDescription>Vanaf twintig kavels kan de basisakte, of de AV met de vereiste meerderheid, deelverenigingen oprichten voor een gebouw van een groep of een fysiek afgescheiden onderdeel. Ze hebben een eigen AV, organen en boekhouding, maar zijn enkel bevoegd voor de particulier gemeenschappelijke delen (art. 3.84 BW).</CardDescription></CardHeader><CardContent className="grid gap-2 text-sm">
    {data.children.map((ch: any) => <Link key={ch.id} to={`/b/${ch.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-accent"><span className="font-medium">{ch.name}</span><span className="text-xs text-muted-foreground">{ch.units} kavels · {ch.total_shares} aandelen</span></Link>)}
    {!data.allowed && !data.children.length && <p className="text-muted-foreground">Dit gebouw telt {data.units} kavels; deelverenigingen zijn mogelijk vanaf twintig.</p>}
    {data.allowed && b.isManager && <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}><Plus />Deelvereniging oprichten</Button>}
    {open && <CreateDialog onClose={() => setOpen(false)} onDone={async () => { setOpen(false); await refresh(); reload(); }} />}
  </CardContent></Card>;
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const units = useFetch<{ units: Unit[] }>(`/api/buildings/${b.id}/units`);
  const decisions = useFetch<{ items: any[] }>(`/api/buildings/${b.id}/decisions`);
  const [f, setF] = useState({ name: "", scope: "", basis: "basisakte", item_id: "", document_id: "" });
  const [sel, setSel] = useState<Record<string, number>>({}); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Deelvereniging oprichten</DialogTitle><DialogDescription>Kies de kavels en hun aandelen in de particulier gemeenschappelijke delen. Trustee maakt een aparte VME aan met spiegelkavels; de eigenaars worden lid en blijven gesynchroniseerd met de hoofdvereniging.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Naam"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="bv. Deelvereniging Blok B" /></Field>
      <Field label="Oprichting door"><Select value={f.basis} onValueChange={(v) => setF({ ...f, basis: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="basisakte">de basisakte</SelectItem><SelectItem value="av">een beslissing van de AV</SelectItem></SelectContent></Select></Field></div>
    <Field label="Particulier gemeenschappelijke delen (bevoegdheid)"><Textarea value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="bv. lift, inkomhal en dak van blok B" /></Field>
    {f.basis === "basisakte" ? <Field label="Basisakte"><DocumentPicker value={f.document_id} onChange={(id) => setF({ ...f, document_id: id })} suggestedName="Basisakte" /></Field>
      : <Field label="Beslissing van de AV"><Select value={f.item_id || NONE} onValueChange={(v) => setF({ ...f, item_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>kies…</SelectItem>{(decisions.data?.items ?? []).filter((d) => d.adopted === 1).map((d) => <SelectItem key={d.id} value={d.id}>{d.title} ({d.decided_on})</SelectItem>)}</SelectContent></Select></Field>}
    <div className="max-h-60 overflow-y-auto rounded-lg border text-sm">{(units.data?.units ?? []).map((u) => <label key={u.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-0"><Checkbox checked={u.id in sel} onCheckedChange={(v) => { const n = { ...sel }; if (v) n[u.id] = u.shares; else delete n[u.id]; setSel(n); }} /><span className="flex-1">{u.label} <span className="text-xs text-muted-foreground">({u.shares} aandelen in de hoofdvereniging)</span></span>{u.id in sel && <Input type="number" min={1} className="h-7 w-24" aria-label={`Aandelen ${u.label}`} value={sel[u.id]} onChange={(e) => setSel({ ...sel, [u.id]: Number(e.target.value) })} />}</label>)}</div>
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={Object.keys(sel).length < 2 || !f.name} onClick={async () => { setError(null); try { const r = await api.post<{ id: string }>(`/api/buildings/${b.id}/sub-associations`, { ...f, item_id: f.item_id || null, document_id: f.document_id || null, units: Object.entries(sel).map(([unit_id, shares]) => ({ unit_id, shares })) }); toast.success("Deelvereniging opgericht"); onDone(); window.location.assign(`/b/${r.id}`); } catch (e) { setError(e); } }}>Oprichten</Button></DialogFooter>
  </DialogContent></Dialog>;
}
