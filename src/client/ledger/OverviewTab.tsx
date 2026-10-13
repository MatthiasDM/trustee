import { Link } from "react-router-dom";
import { Banknote, Landmark, PiggyBank, Receipt, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { useBuilding, useFetch } from "../components/Layout";
import { toast } from "sonner";
import { api } from "../lib/api";
import { FileText } from "lucide-react";
import { Spinner, Stat } from "../components/ui";
import { Button } from "../components/ui/button";
import { eur, Money, type FiscalYear } from "./shared";

export function OverviewTab({ buildingId, fy, isBoard }: { buildingId: string; fy: FiscalYear | null; isBoard: boolean }) {
  const { data, loading } = useFetch<any>(fy ? `/api/buildings/${buildingId}/ledger/reports/summary?fy=${fy.id}&until=${fy.end_date}` : null, [fy?.id]);
  const b = useBuilding();
  if (!fy) return <p className="text-sm text-muted-foreground">Nog geen boekjaar. {isBoard ? "Maak er een aan onder Instellingen." : ""}</p>;
  if (loading || !data) return <Spinner />;
  const { cash, result, balance } = data;
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Werkkapitaal op bank" value={eur(cash.working_bank)} icon={<Banknote />} />
      <Stat label="Reservekapitaal op bank" value={eur(cash.reserve_bank + cash.deposits)} icon={<PiggyBank />} />
      <Stat label="Nog te ontvangen van eigenaars" value={eur(cash.open_receivables)} icon={<Receipt />} />
      <Stat label="Open leveranciersfacturen" value={eur(cash.suppliers_open)} icon={<Landmark />} />
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-5 shadow-xs"><h3 className="mb-3 flex items-center gap-2 font-semibold"><Scale className="size-4 text-primary" />Resultaat boekjaar {fy.label}</h3>
        <div className="grid grid-cols-3 gap-3 text-sm"><div><div className="text-xs text-muted-foreground">Voorschotten & opbrengsten</div><div className="flex items-center gap-1 text-lg font-semibold"><TrendingUp className="size-4 text-emerald-600" /><Money n={result.total_income} /></div></div><div><div className="text-xs text-muted-foreground">Kosten</div><div className="flex items-center gap-1 text-lg font-semibold"><TrendingDown className="size-4 text-destructive" /><Money n={result.total_expenses} /></div></div><div><div className="text-xs text-muted-foreground">Saldo</div><div className="text-lg font-semibold"><Money n={result.result} /></div></div></div>
        <p className="mt-3 text-xs text-muted-foreground">Een positief saldo blijft bij afsluiting als overgedragen werk- of reservekapitaal (rekeningen 48902 / 48901) van de mede-eigenaars.</p></div>
      <div className="rounded-xl border bg-card p-5 shadow-xs"><h3 className="mb-3 font-semibold">Balans op {fy.end_date}</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Actief</div>{balance.assets.map((a: any) => <div key={a.code} className="flex justify-between gap-2 py-0.5"><span className="truncate"><span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}</span><Money n={a.amount} /></div>)}<div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Totaal</span><Money n={balance.total_assets} /></div></div>
          <div><div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Passief</div>{balance.liabilities.map((a: any) => <div key={a.code} className="flex justify-between gap-2 py-0.5"><span className="truncate"><span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}</span><Money n={a.amount} /></div>)}{balance.unallocated_result !== 0 && <div className="flex justify-between gap-2 py-0.5"><span className="truncate italic">Resultaat van het boekjaar (nog over te dragen)</span><Money n={balance.unallocated_result} /></div>}<div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Totaal</span><Money n={balance.total_liabilities + balance.unallocated_result} /></div></div>
        </div></div>
    </div>
    <div className="flex flex-wrap gap-2">{b.isManager && <Button size="sm" onClick={async () => { const r = await api.post<any>(`/api/buildings/${buildingId}/ledger/fiscal-years/${fy.id}/report`); toast.success(`${r.provisional ? "Voorlopige j" : "J"}aarrekening als PDF bewaard onder Documenten`); window.open(`/api/buildings/${buildingId}/documents/${r.documentId}/download?inline=1`, "_blank"); }}><FileText />Jaarrekening (PDF)</Button>}{(fy as any).report_document_id && <Button variant="outline" size="sm" asChild><a href={`/api/buildings/${buildingId}/documents/${(fy as any).report_document_id}/download?inline=1`} target="_blank" rel="noreferrer">Definitieve jaarrekening</a></Button>}<Button variant="outline" size="sm" asChild><a href={`/api/buildings/${buildingId}/ledger/reports/export.csv?fy=${fy.id}`}>Dagboek exporteren (CSV)</a></Button><Button variant="outline" size="sm" asChild><Link to="/help?tab=wet">Wettelijk kader boekhouding</Link></Button></div>
  </div>;
}
