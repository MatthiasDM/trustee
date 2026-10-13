import { useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { ErrorBox, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api } from "../lib/api";
import { AccountSelect, Money, type Account, type FiscalYear } from "./shared";

/** Begroting (art. 3.89 §5 16°): gewone en buitengewone kosten, vergeleken met werkelijkheid en vorig jaar. */
export function BudgetTab({ fy, accounts }: { fy: FiscalYear | null; accounts: Account[] }) {
  const b = useBuilding();
  const { data, loading, reload } = useFetch<any>(fy ? `/api/buildings/${b.id}/ledger/budgets/${fy.id}` : null, [fy?.id]);
  const [lines, setLines] = useState<{ account_id: string; code: string; kind: string; amount: string }[]>([]);
  const [notes, setNotes] = useState(""); const [editing, setEditing] = useState(false); const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (data) { setLines(data.lines.map((l: any) => ({ account_id: l.account_id, code: l.code, kind: l.kind, amount: String(l.amount) }))); setNotes(data.budget?.notes ?? ""); } }, [data]);
  if (!fy) return <p className="text-sm text-muted-foreground">Geen boekjaar.</p>;
  if (loading || !data) return <Spinner />;
  const approved = data.budget?.status === "approved";
  const actualOf = (id: string) => data.actual.find((a: any) => a.account_id === id)?.amount ?? 0;
  const prevOf = (id: string) => data.previous.find((a: any) => a.account_id === id)?.amount ?? 0;
  const tot = (k: string) => lines.filter((l) => l.kind === k).reduce((s, l) => s + (+l.amount || 0), 0);
  const save = async () => { setError(null); try { await api.put(`/api/buildings/${b.id}/ledger/budgets/${fy.id}`, { notes, lines: lines.filter((l) => l.account_id).map((l) => ({ account_id: l.account_id, kind: l.kind, amount: +l.amount || 0 })) }); toast.success("Begroting opgeslagen"); setEditing(false); reload(); } catch (err) { setError(err); } };
  const canEdit = b.isManager && !approved;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm text-muted-foreground">Begroting {fy.label}: {approved ? <Badge variant="success"><Check />Goedgekeurd door de AV{data.budget.meeting_title ? ` (${data.budget.meeting_title})` : ""}</Badge> : data.budget ? <Badge variant="warning">Ontwerp, nog goed te keuren door de AV</Badge> : <Badge variant="outline">Nog geen begroting</Badge>}</div>
      <div className="flex gap-2">{canEdit && !editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Bewerken</Button>}{canEdit && editing && <><Button variant="outline" size="sm" onClick={() => setLines([...lines, { account_id: "", code: "", kind: "ordinary", amount: "" }])}><Plus />Rubriek</Button><Button size="sm" onClick={save}>Opslaan</Button></>}{b.isManager && data.budget && !approved && !editing && <Button size="sm" onClick={async () => { if (confirm("Begroting markeren als goedgekeurd door de AV?")) { await api.post(`/api/buildings/${b.id}/ledger/budgets/${fy.id}/approve`, {}); reload(); } }}>Goedgekeurd door AV</Button>}</div></div>
    {(["ordinary", "extraordinary"] as const).map((kind) => <div key={kind} className="rounded-xl border bg-card shadow-xs"><div className="border-b px-4 py-2.5 text-sm font-medium">{kind === "ordinary" ? "Gewone kosten (werkkapitaal)" : "Buitengewone kosten en werken (reservekapitaal)"}</div>
      <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Rubriek</th><th className="px-2 py-2 text-right">Vorig jaar</th><th className="px-2 py-2 text-right">Begroot</th><th className="px-2 py-2 text-right">Werkelijk</th><th className="px-4 py-2 text-right">Verschil</th>{editing && <th />}</tr></thead>
        <tbody>{lines.map((l, i) => l.kind === kind && <tr key={i} className="border-t"><td className="px-4 py-1.5">{editing ? <AccountSelect accounts={accounts} filter="6" value={l.code} onChange={(code) => setLines(lines.map((x, j) => j === i ? { ...x, code, account_id: accounts.find((a) => a.code === code)?.id ?? "" } : x))} /> : <><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {accounts.find((a) => a.id === l.account_id)?.name}</>}</td><td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{prevOf(l.account_id).toFixed(2)}</td><td className="px-2 py-1.5 text-right">{editing ? <Input className="ml-auto w-28 text-right" type="number" step="0.01" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /> : <span className="tabular-nums">{(+l.amount).toFixed(2)}</span>}</td><td className="px-2 py-1.5 text-right tabular-nums">{actualOf(l.account_id).toFixed(2)}</td><td className="px-4 py-1.5 text-right"><Money n={+l.amount - actualOf(l.account_id)} /></td>{editing && <td><div className="flex gap-1"><Select value={l.kind} onValueChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, kind: v } : x))}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ordinary">Gewoon</SelectItem><SelectItem value="extraordinary">Buitengewoon</SelectItem></SelectContent></Select><Button variant="ghost" size="icon-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X /></Button></div></td>}</tr>)}
          <tr className="border-t bg-muted/30 font-medium"><td className="px-4 py-2">Totaal</td><td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{lines.filter((l) => l.kind === kind).reduce((s, l) => s + prevOf(l.account_id), 0).toFixed(2)}</td><td className="px-2 py-2 text-right tabular-nums">{tot(kind).toFixed(2)}</td><td className="px-2 py-2 text-right tabular-nums">{lines.filter((l) => l.kind === kind).reduce((s, l) => s + actualOf(l.account_id), 0).toFixed(2)}</td><td className="px-4 py-2 text-right"><Money n={tot(kind) - lines.filter((l) => l.kind === kind).reduce((s, l) => s + actualOf(l.account_id), 0)} /></td>{editing && <td />}</tr></tbody></table></div>)}
    {data.actual.filter((a: any) => !lines.some((l) => l.account_id === a.account_id)).length > 0 && <p className="text-xs text-muted-foreground">Niet begroot maar wel geboekt: {data.actual.filter((a: any) => !lines.some((l) => l.account_id === a.account_id)).map((a: any) => `${a.code} (€ ${a.amount.toFixed(2)})`).join(", ")}</p>}
    {editing ? <Textarea placeholder="Toelichting bij de begroting voor de AV" value={notes} onChange={(e) => setNotes(e.target.value)} /> : notes && <p className="text-sm whitespace-pre-wrap">{notes}</p>}
    <ErrorBox error={error} />
  </div>;
}
