import { useFetch, useBuilding } from "../components/Layout";
import { Spinner } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Send } from "lucide-react";
import { Money, type FiscalYear } from "./shared";

/** Afrekening per kavel: aandeel in de kosten (via verdeelsleutels) tegenover opgeroepen en betaalde voorschotten. */
export function StatementsTab({ fy }: { fy: FiscalYear | null }) {
  const b = useBuilding();
  const { data, loading } = useFetch<any>(fy ? `/api/buildings/${b.id}/ledger/statements/${fy.id}` : null, [fy?.id]);
  if (!fy) return <p className="text-sm text-muted-foreground">Geen boekjaar.</p>;
  if (loading || !data) return <Spinner />;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{b.isBoard ? "Afrekening van alle kavels." : "Jouw kavel(s). Andere eigenaars zien enkel hun eigen afrekening."} Kosten worden verdeeld volgens de verdeelsleutel per boeking; werkkapitaal dekt de gewone kosten. Een positief resultaat is te veel betaald voorschot, een negatief resultaat moet bijgepast worden.</p>
    {data.units.map((u: any) => <div key={u.unit_id} className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-semibold">Kavel {u.label}</span> <span className="text-xs text-muted-foreground">· {u.shares} aandelen{u.owners ? ` · ${u.owners}` : ""}</span></div>
        <div className="flex flex-wrap gap-2 text-sm"><Badge variant="secondary">Kosten <Money n={u.total_cost} /></Badge><Badge variant="info">Opgeroepen werk <Money n={u.working.called} /></Badge><Badge variant="violet">Opgeroepen reserve <Money n={u.reserve.called} /></Badge>{u.outstanding > 0 ? <Badge variant="red">Nog te betalen <Money n={u.outstanding} /></Badge> : <Badge variant="success">Alles betaald</Badge>}<Badge variant={u.result >= 0 ? "success" : "warning"}>Resultaat <Money n={u.result} /></Badge></div></div>
      {u.costs.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer text-primary">Detail kosten ({u.costs.length} rubrieken)</summary><table className="mt-2 w-full"><tbody>{u.costs.map((c: any) => <tr key={c.code} className="border-t"><td className="py-1"><span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.name}</td><td className="py-1 text-right tabular-nums">{c.amount.toFixed(2)}</td></tr>)}</tbody></table></details>}
      {u.opening_balance !== 0 && <p className="mt-1 text-xs text-muted-foreground">Openstaand saldo uit vorige boekjaren: <Money n={u.opening_balance} /></p>}
    </div>)}
    {b.isBoard && <div className="flex flex-wrap items-center justify-between gap-2 text-sm">{b.isManager ? <Button size="sm" onClick={async () => { if (!confirm("Voor elke kavel een individuele afrekening (PDF) aanmaken en de eigenaars verwittigen?")) return; const r = await api.post<any>(`/api/buildings/${b.id}/ledger/statements/${fy.id}/send`, { notify: true }); toast.success(`${r.sent} afrekeningen verstuurd`); }}><Send />Afrekeningen versturen (PDF per kavel)</Button> : <span />}<span>Totaal verdeelde kosten: <Money n={data.total_cost} className="font-semibold" /></span></div>}
  </div>;
}
