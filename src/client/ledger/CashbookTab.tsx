import { useFetch, useBuilding } from "../components/Layout";
import { Spinner, Stat } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Wallet } from "lucide-react";
import { fmtDate } from "../lib/api";
import { eur, Money, type FiscalYear } from "./shared";

/** Kasboek: de vereenvoudigde boekhouding (ontvangsten, uitgaven, kaspositie, werk- en reservekapitaal). */
export function CashbookTab({ fy }: { fy: FiscalYear | null }) {
  const b = useBuilding();
  const { data, loading } = useFetch<any>(fy ? `/api/buildings/${b.id}/ledger/cashbook/${fy.id}` : null, [fy?.id]);
  if (!fy) return <p className="text-sm text-muted-foreground">Geen boekjaar.</p>;
  if (loading || !data) return <Spinner />;
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Ontvangsten" value={eur(data.total_in)} icon={<ArrowDownLeft />} /><Stat label="Uitgaven" value={eur(data.total_out)} icon={<ArrowUpRight />} /><Stat label="Werkkapitaal op de rekeningen" value={eur(data.capital.working)} icon={<Wallet />} /><Stat label="Reservekapitaal op de rekeningen" value={eur(data.capital.reserve)} icon={<PiggyBank />} /></div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border bg-card shadow-xs"><div className="border-b px-4 py-2.5 text-sm font-medium">Per rubriek</div><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Rubriek</th><th className="px-2 py-2 text-right">Ontvangen</th><th className="px-4 py-2 text-right">Uitgegeven</th></tr></thead><tbody>{data.by_rubriek.map((r: any) => <tr key={r.rubriek} className="border-t"><td className="px-4 py-1.5">{r.rubriek}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.in ? r.in.toFixed(2) : ""}</td><td className="px-4 py-1.5 text-right tabular-nums">{r.out ? r.out.toFixed(2) : ""}</td></tr>)}<tr className="border-t bg-muted/30 font-medium"><td className="px-4 py-2">Totaal</td><td className="px-2 py-2 text-right tabular-nums">{data.total_in.toFixed(2)}</td><td className="px-4 py-2 text-right tabular-nums">{data.total_out.toFixed(2)}</td></tr></tbody></table></div>
      <div className="rounded-xl border bg-card shadow-xs"><div className="border-b px-4 py-2.5 text-sm font-medium">Kaspositie</div><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Rekening</th><th className="px-2 py-2 text-right">Begin</th><th className="px-4 py-2 text-right">Nu</th></tr></thead><tbody>{data.position.map((p: any) => <tr key={p.code} className="border-t"><td className="px-4 py-1.5">{p.name} <Badge variant={p.fund === "reserve" ? "violet" : "info"}>{p.fund === "reserve" ? "reserve" : "werk"}</Badge></td><td className="px-2 py-1.5 text-right tabular-nums">{p.opening.toFixed(2)}</td><td className="px-4 py-1.5 text-right tabular-nums font-medium">{p.closing.toFixed(2)}</td></tr>)}</tbody></table><p className="px-4 py-2 text-xs text-muted-foreground">Nog te innen: werkkapitaal <Money n={data.capital.working_receivable} />, reservekapitaal <Money n={data.capital.reserve_receivable} />.</p></div>
    </div>
    <div className="rounded-xl border bg-card shadow-xs"><div className="border-b px-4 py-2.5 text-sm font-medium">Alle bewegingen</div>
      {!data.movements.length ? <p className="p-6 text-center text-sm text-muted-foreground">Nog geen bewegingen in dit boekjaar.</p> : <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Datum</th><th className="px-2 py-2">Omschrijving</th><th className="px-2 py-2">Rubriek</th><th className="px-2 py-2">Rekening</th><th className="px-2 py-2 text-right">Bedrag</th><th className="px-4 py-2 text-right">Saldo</th></tr></thead><tbody>{data.movements.map((m: any, i: number) => <tr key={i} className="border-t"><td className="px-4 py-1.5 whitespace-nowrap text-muted-foreground">{fmtDate(m.date)}</td><td className="px-2 py-1.5">{m.description}{m.units ? <span className="text-xs text-muted-foreground"> · kavel {m.units}</span> : null}</td><td className="px-2 py-1.5 text-xs text-muted-foreground">{m.category}</td><td className="px-2 py-1.5 text-xs text-muted-foreground">{m.bank_code}</td><td className="px-2 py-1.5 text-right"><Money n={m.amount} /></td><td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{m.balance_after.toFixed(2)}</td></tr>)}</tbody></table>}</div>
  </div>;
}
