import { useMemo, useState } from "react";
import { useBuilding, useFetch } from "../components/Layout";
import { Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { type FiscalYear } from "./shared";

type Row = { code: string; name: string; group_name?: string | null; class: number; type: string; fund: string | null; period: string; quarter: string; group: string; net: number };
const CLASS_NAMES: Record<number, string> = { 1: "Schulden > 1 jaar", 2: "Vaste activa", 4: "Vorderingen en schulden", 5: "Bank en kas", 6: "Kosten", 7: "Opbrengsten" };

/** Draaitabel: rijen = rekening / groep / klasse, kolommen = maand / kwartaal / jaar. */
export function ReportsTab({ fy }: { fy: FiscalYear | null }) {
  const b = useBuilding();
  const { data, loading } = useFetch<Row[]>(fy ? `/api/buildings/${b.id}/ledger/reports/pivot/${fy.id}` : null, [fy?.id]);
  const [rowDim, setRowDim] = useState<"account" | "group" | "class">("group");
  const [colDim, setColDim] = useState<"period" | "quarter" | "year">("quarter");
  const [classes, setClasses] = useState<"pl" | "all" | "6" | "7">("pl");
  const pivot = useMemo(() => {
    if (!data) return null;
    const rows = data.filter((r) => classes === "all" ? true : classes === "pl" ? r.class === 6 || r.class === 7 : r.class === +classes);
    const colKey = (r: Row) => colDim === "period" ? r.period : colDim === "quarter" ? r.quarter : r.period.slice(0, 4);
    const rowKey = (r: Row) => rowDim === "account" ? `${r.code} ${r.name}` : rowDim === "group" ? `${r.group} ${groupName(r)}` : `${r.class} ${CLASS_NAMES[r.class] ?? ""}`;
    const cols = [...new Set(rows.map(colKey))].sort();
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) { const rk = rowKey(r); if (!m.has(rk)) m.set(rk, new Map()); const cm = m.get(rk)!; cm.set(colKey(r), (cm.get(colKey(r)) ?? 0) + r.net); }
    const lines = [...m.entries()].sort(([a], [c]) => a.localeCompare(c)).map(([k, cm]) => ({ key: k, cells: cols.map((c) => cm.get(c) ?? 0), total: [...cm.values()].reduce((s, v) => s + v, 0) }));
    const totals = cols.map((_, i) => lines.reduce((s, l) => s + l.cells[i], 0));
    return { cols, lines, totals, grand: totals.reduce((s, v) => s + v, 0) };
  }, [data, rowDim, colDim, classes]);
  if (!fy) return <p className="text-sm text-muted-foreground">Geen boekjaar.</p>;
  if (loading || !pivot) return <Spinner />;
  const fmt = (n: number) => n === 0 ? "" : n.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Rijen</span><Select value={rowDim} onValueChange={(v) => setRowDim(v as any)}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="class">Klasse</SelectItem><SelectItem value="group">Rubriek (3 cijfers)</SelectItem><SelectItem value="account">Rekening</SelectItem></SelectContent></Select>
      <span className="text-muted-foreground">Kolommen</span><Select value={colDim} onValueChange={(v) => setColDim(v as any)}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="period">Maand</SelectItem><SelectItem value="quarter">Kwartaal</SelectItem><SelectItem value="year">Boekjaar</SelectItem></SelectContent></Select>
      <span className="text-muted-foreground">Inhoud</span><Select value={classes} onValueChange={(v) => setClasses(v as any)}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pl">Kosten en opbrengsten</SelectItem><SelectItem value="6">Enkel kosten</SelectItem><SelectItem value="7">Enkel opbrengsten</SelectItem><SelectItem value="all">Alle rekeningen (bewegingen)</SelectItem></SelectContent></Select>
      <Button variant="outline" size="sm" className="ml-auto" onClick={() => { const csv = ["﻿" + ["", ...pivot.cols, "Totaal"].join(";"), ...pivot.lines.map((l) => [l.key, ...l.cells.map((c) => c.toFixed(2).replace(".", ",")), l.total.toFixed(2).replace(".", ",")].join(";")), ["Totaal", ...pivot.totals.map((c) => c.toFixed(2).replace(".", ",")), pivot.grand.toFixed(2).replace(".", ",")].join(";")].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `draaitabel-${fy.label}.csv`; a.click(); }}>CSV</Button>
    </div>
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs"><table className="w-full text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">{rowDim === "account" ? "Rekening" : rowDim === "group" ? "Rubriek" : "Klasse"}</th>{pivot.cols.map((c) => <th key={c} className="px-3 py-2 text-right whitespace-nowrap">{c}</th>)}<th className="px-3 py-2 text-right">Totaal</th></tr></thead>
      <tbody>{pivot.lines.map((l) => <tr key={l.key} className="border-t hover:bg-muted/30"><td className="px-3 py-1.5 whitespace-nowrap"><span className="font-mono text-xs text-muted-foreground">{l.key.split(" ")[0]}</span> {l.key.slice(l.key.indexOf(" ") + 1)}</td>{l.cells.map((c, i) => <td key={i} className="px-3 py-1.5 text-right tabular-nums">{fmt(c)}</td>)}<td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmt(l.total)}</td></tr>)}
        <tr className="border-t bg-muted/30 font-semibold"><td className="px-3 py-2">Totaal</td>{pivot.totals.map((c, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{fmt(c)}</td>)}<td className="px-3 py-2 text-right tabular-nums">{fmt(pivot.grand)}</td></tr></tbody></table>
      {!pivot.lines.length && <p className="p-6 text-center text-sm text-muted-foreground">Geen boekingen in dit boekjaar.</p>}</div>
    <p className="text-xs text-muted-foreground">Kosten en activa tellen als positieve debetsaldo's, opbrengsten en passiva als positieve creditsaldo's. Bij "kosten en opbrengsten" is het totaal = opbrengsten + kosten (geen saldo); gebruik Overzicht voor het resultaat.</p>
  </div>;
}
function groupName(r: Row) { return r.group_name ?? r.name.split(":")[0].replace(/\s*\(.*\)$/, ""); }
