import { useState, type FormEvent } from "react";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { AccountSelect, Money, type Account } from "./shared";

export function AssetsTab({ accounts, onPosted }: { accounts: Account[]; onPosted: () => void }) {
  const b = useBuilding();
  const assets = useFetch<any[]>(`/api/buildings/${b.id}/ledger/assets`);
  const [open, setOpen] = useState(false);
  return <div>
    <div className="mb-4 flex items-start justify-between gap-3"><p className="text-sm text-muted-foreground">Investeringen staan op de balans en worden lineair afgeschreven. De afschrijvingen van toekomstige periodes staan al als geplande boekingen in het dagboek en worden automatisch geboekt op de laatste dag van de periode.</p>{b.isManager && <Button onClick={() => setOpen(true)}><Plus />Actief</Button>}</div>
    {assets.loading ? <Spinner /> : !assets.data?.length ? <Empty icon={<Package />} title="Geen vaste activa" /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{assets.data.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"><div className="min-w-0 flex-1"><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">Rekening {a.asset_code} · aangekocht {fmtDate(a.acquired_at)} · {a.years} jaar {a.frequency === "monthly" ? "(maandelijks)" : "(jaarlijks)"}</div></div><div className="text-right"><div>Aanschaf <Money n={a.cost} /></div><div className="text-xs text-muted-foreground">Afgeschreven <Money n={a.depreciated} /> · boekwaarde <Money n={a.book_value} /></div></div>{a.scheduled_count > 0 && <Badge variant="info">{a.scheduled_count} gepland</Badge>}</div>)}</div>}
    {open && <AssetDialog accounts={accounts} onClose={() => setOpen(false)} onDone={() => { setOpen(false); assets.reload(); onPosted(); }} />}
  </div>;
}

function AssetDialog({ accounts, onClose, onDone }: { accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ name: "", asset_code: "2300", cost: "", acquired_at: new Date().toISOString().slice(0, 10), years: "5", frequency: "yearly" }); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Vast actief registreren</DialogTitle><DialogDescription>Boek de aankoop zelf via de handeling "Aankoop vast actief"; hier leg je het afschrijvingsplan vast.</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { const r = await api.post<any>(`/api/buildings/${b.id}/ledger/assets`, { ...f, cost: +f.cost, years: +f.years }); toast.success(r.note ?? `${r.scheduled} afschrijvingen gepland`); onDone(); } catch (err) { setError(err); } }}>
      <Field label="Omschrijving"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="bv. Grasmaaier Honda" /></Field>
      <Field label="Activarekening"><AccountSelect accounts={accounts.filter((a) => a.code.endsWith("0"))} filter="2" value={f.asset_code} onChange={(v) => setF({ ...f, asset_code: v })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Aanschaffingswaarde (€)"><Input type="number" step="0.01" min="0.01" required value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field><Field label="Aankoopdatum"><Input type="date" required value={f.acquired_at} onChange={(e) => setF({ ...f, acquired_at: e.target.value })} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Afschrijvingstermijn (jaar)"><Input type="number" min="1" max="50" required value={f.years} onChange={(e) => setF({ ...f, years: e.target.value })} /></Field><Field label="Frequentie"><Select value={f.frequency} onValueChange={(v) => setF({ ...f, frequency: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yearly">Jaarlijks</SelectItem><SelectItem value="monthly">Maandelijks</SelectItem></SelectContent></Select></Field></div>
      <ErrorBox error={error} /><DialogFooter><Button>Plan aanmaken</Button></DialogFooter></form></DialogContent></Dialog>;
}
