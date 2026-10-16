import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { useBuilding } from "./Layout";
import { ErrorBox, Field, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api } from "../lib/api";
import type { Member, Unit } from "../../shared/types";

const NEW = "__new__";
const eur = (n: number) => `€ ${(n ?? 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Verkoop van een kavel afrekenen (art. 3.94 §5 en 3.95 BW): werkkapitaal pro rata terug aan de verkoper en opgevraagd bij de koper,
 * reservekapitaal blijft bij de VME, achterstallen van de verkoper apart voor de notaris; daarna wordt de koper eigenaar.
 */
export function TransferDialog({ unit, members, onClose, onDone }: { unit: Unit; members: Member[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ transfer_date: today, act_date: "", notary: "", buyer: NEW, buyer_email: "", buyer_name: "", refund: "", due_date: "", remove_sellers: true });
  const [p, setP] = useState<any>(null); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setP(null); setError(null); api.post<any>(`/api/buildings/${b.id}/units/${unit.id}/transfer/preview`, { transfer_date: f.transfer_date }).then((r) => { setP(r); setF((x) => ({ ...x, refund: String(r.working_refund) })); }).catch(setError); }, [f.transfer_date]);
  const sellers = new Set((unit.owners ?? []).map((o) => o.user_id));
  const candidates = members.filter((m) => !sellers.has(m.user_id) && m.role !== "syndicus");
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<any>(`/api/buildings/${b.id}/units/${unit.id}/transfer`, { transfer_date: f.transfer_date, act_date: f.act_date || null, notary: f.notary || null, buyer_user_id: f.buyer === NEW ? null : f.buyer, buyer_email: f.buyer === NEW ? f.buyer_email : null, buyer_name: f.buyer === NEW ? f.buyer_name || null : null, working_refund: Number(f.refund), due_date: f.due_date || null, remove_sellers: f.remove_sellers });
      toast.success(`Kavel ${unit.label} overgedragen${r.ogm ? `; koper betaalt ${eur(r.refund)} met ${r.ogm}` : ""}`);
      window.open(`/api/buildings/${b.id}/documents/${r.document_id}/download`, "_blank");
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Verkoop afrekenen: kavel {unit.label}</DialogTitle><DialogDescription>De syndicus stelt de afrekening op (art. 3.94 §5 BW). Het werkkapitaal voor de periode na de overdracht gaat terug naar de verkoper en wordt opgevraagd bij de koper; het reservekapitaal blijft bij de VME; achterstallen van de verkoper houdt de notaris af (art. 3.95). Gebruik eerst <em>Overdracht</em> voor het dossier dat de notaris vóór de verkoop vraagt.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Overdrachtsdatum" hint="Dag waarop de koper de gemene delen kan gebruiken."><Input type="date" value={f.transfer_date} onChange={(e) => setF({ ...f, transfer_date: e.target.value })} /></Field>
      <Field label="Datum akte"><Input type="date" value={f.act_date} onChange={(e) => setF({ ...f, act_date: e.target.value })} /></Field>
      <Field label="Notaris"><Input value={f.notary} onChange={(e) => setF({ ...f, notary: e.target.value })} placeholder="bv. notaris Janssens, Brugge" /></Field>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Koper"><Select value={f.buyer} onValueChange={(v) => setF({ ...f, buyer: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NEW}>Nieuwe eigenaar uitnodigen</SelectItem>{candidates.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select></Field>
      {f.buyer === NEW && <><Field label="E-mail koper"><Input type="email" value={f.buyer_email} onChange={(e) => setF({ ...f, buyer_email: e.target.value })} /></Field><Field label="Naam koper"><Input value={f.buyer_name} onChange={(e) => setF({ ...f, buyer_name: e.target.value })} /></Field></>}
    </div>
    {!p ? (error ? null : <Spinner />) : <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <div>Verkoper(s): <strong>{p.sellers.map((s: any) => s.name).join(", ")}</strong> · boekjaar {p.fiscal_year.label}</div>
      <div className="grid gap-1 sm:grid-cols-2">
        <span>Opgevraagd werkkapitaal dit boekjaar</span><span className="text-right tabular-nums">{eur(p.working_called)}</span>
        <span>Pro rata na overdracht ({p.days_after}/{p.fy_days} dagen)</span><span className="text-right tabular-nums">{eur(p.working_refund)}</span>
        <span>Reservekapitaal ingebracht (blijft bij de VME)</span><span className="text-right tabular-nums">{eur(p.reserve_paid)}</span>
        <span>Achterstallen verkoper (af te houden door de notaris)</span><span className={`text-right tabular-nums ${p.arrears_total > 0 ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{eur(p.arrears_total)}</span>
      </div>
      {p.pending_decisions.length > 0 && <p className="text-xs text-muted-foreground">Beslist vóór de overdracht, ten laste van de koper tenzij anders afgesproken (art. 3.94 §2): {p.pending_decisions.map((d: any) => d.title).join("; ")}.</p>}
    </div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Afrekening werkkapitaal (€)" hint="Voorstel pro rata; de syndicus kan het aanpassen."><Input type="number" min={0} step="0.01" value={f.refund} onChange={(e) => setF({ ...f, refund: e.target.value })} /></Field>
      <Field label="Vervaldag voor de koper"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
    </div>
    <label className="flex items-start gap-2 text-sm"><Checkbox checked={f.remove_sellers} onCheckedChange={(v) => setF({ ...f, remove_sellers: !!v })} className="mt-0.5" /><span>Verkopers zonder andere kavel verlaten de VME op het platform (ze zijn geen mede-eigenaar meer).</span></label>
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={busy || !p || (f.buyer === NEW && !f.buyer_email)} onClick={submit}><ArrowRightLeft />Afrekening boeken en overdragen</Button></DialogFooter>
  </DialogContent></Dialog>;
}
