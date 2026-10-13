import { useState, type FormEvent } from "react";
import { AlertOctagon, CheckCircle2, FileText, MessageSquareText, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, RoleBadge, Spinner, UserAvatar } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate, timeAgo } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AccountSelect, Money, type Account, type Entry, type FiscalYear } from "./shared";

const STATUS: Record<string, { label: string; variant: any }> = { posted: { label: "Geboekt", variant: "success" }, scheduled: { label: "Gepland", variant: "info" }, reversed: { label: "Tegengeboekt", variant: "secondary" } };
const SOURCE: Record<string, string> = { manual: "Vrije post", template: "Handeling", depreciation: "Afschrijving", bank: "Bank", call: "Oproep", closing: "Afsluiting" };

export function JournalTab({ fy, accounts }: { fy: FiscalYear | null; accounts: Account[] }) {
  const b = useBuilding();
  const [q, setQ] = useState(""); const [acc, setAcc] = useState(""); const [status, setStatus] = useState("all");
  const url = fy ? `/api/buildings/${b.id}/ledger/entries?fy=${fy.id}${q ? `&q=${encodeURIComponent(q)}` : ""}${acc ? `&account=${accounts.find((a) => a.code === acc)?.id}` : ""}${status !== "all" ? `&status=${status}` : ""}` : null;
  const entries = useFetch<Entry[]>(url, [fy?.id, q, acc, status]);
  const [open, setOpen] = useState(false); const [detail, setDetail] = useState<Entry | null>(null);
  if (!fy) return <p className="text-sm text-muted-foreground">Geen boekjaar.</p>;
  return <div>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Zoek omschrijving of tegenpartij" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="w-full sm:w-72"><AccountSelect accounts={accounts} value={acc} onChange={setAcc} placeholder="Alle rekeningen" /></div>
      <Select value={status} onValueChange={setStatus}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle statussen</SelectItem><SelectItem value="posted">Geboekt</SelectItem><SelectItem value="scheduled">Gepland</SelectItem><SelectItem value="reversed">Tegengeboekt</SelectItem></SelectContent></Select>
      {b.isManager && fy.status === "open" && <Button className="ml-auto" onClick={() => setOpen(true)}><Plus />Vrije journaalpost</Button>}
    </div>
    {entries.loading ? <Spinner /> : !entries.data?.length ? <Empty icon={<FileText />} title="Nog geen boekingen in dit boekjaar" hint="Boek een handeling of importeer bankverrichtingen." /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{entries.data.map((e) => <button key={e.id} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 cursor-pointer" onClick={() => setDetail(e)}>
        <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-xs text-muted-foreground">#{e.number}</span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm font-medium">{e.description}{e.status !== "posted" && <Badge variant={STATUS[e.status].variant}>{STATUS[e.status].label}</Badge>}{e.comment_count > 0 && <Badge variant="outline"><MessageSquareText />{e.comment_count}</Badge>}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(e.date)} · {SOURCE[e.source] ?? e.source}{e.counterparty ? ` · ${e.counterparty}` : ""}{e.document_name ? ` · 📎 ${e.document_name}` : ""}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">{e.lines.map((l) => <span key={l.id} className="text-muted-foreground"><span className="font-mono">{l.code}</span> {l.debit ? `D ${l.debit.toFixed(2)}` : `C ${l.credit.toFixed(2)}`}{l.unit_label ? ` (${l.unit_label})` : ""}</span>)}</div></div>
        <Money n={e.total} className="shrink-0 text-sm font-medium" />
      </button>)}</div>}
    {open && <ManualEntryDialog accounts={accounts} onClose={() => setOpen(false)} onDone={() => { setOpen(false); entries.reload(); }} />}
    {detail && <EntryDialog entry={detail} canReverse={b.isManager && fy.status === "open"} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); entries.reload(); }} />}
  </div>;
}

function ManualEntryDialog({ accounts, onClose, onDone }: { accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), description: "", counterparty: "" });
  const [lines, setLines] = useState([{ account_code: "", debit: "", credit: "" }, { account_code: "", debit: "", credit: "" }]);
  const [error, setError] = useState<unknown>(null);
  const d = lines.reduce((s, l) => s + (+l.debit || 0), 0), c = lines.reduce((s, l) => s + (+l.credit || 0), 0);
  const upd = (i: number, p: any) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l));
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Vrije journaalpost</DialogTitle><DialogDescription>Debet en credit moeten gelijk zijn. Eenmaal geboekt is een post onwijzigbaar; corrigeren gebeurt via tegenboeking.</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/entries`, { ...f, lines: lines.map((l) => ({ account_code: l.account_code, debit: +l.debit || 0, credit: +l.credit || 0 })) }); toast.success("Geboekt"); onDone(); } catch (err) { setError(err); } }}>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Datum"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label="Omschrijving" className="sm:col-span-2"><Input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      <div className="grid gap-2">{lines.map((l, i) => <div key={i} className="grid grid-cols-12 gap-2"><div className="col-span-6"><AccountSelect accounts={accounts} value={l.account_code} onChange={(v) => upd(i, { account_code: v })} /></div><Input className="col-span-2" type="number" step="0.01" min="0" placeholder="Debet" value={l.debit} onChange={(e) => upd(i, { debit: e.target.value, credit: "" })} /><Input className="col-span-2" type="number" step="0.01" min="0" placeholder="Credit" value={l.credit} onChange={(e) => upd(i, { credit: e.target.value, debit: "" })} /><div className="col-span-2 flex justify-end">{lines.length > 2 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X /></Button>}</div></div>)}
        <div className="flex items-center justify-between"><Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { account_code: "", debit: "", credit: "" }])}><Plus />Lijn</Button><span className={`text-sm tabular-nums ${Math.abs(d - c) < 0.005 ? "text-emerald-600" : "text-destructive"}`}>D {d.toFixed(2)} / C {c.toFixed(2)}{Math.abs(d - c) >= 0.005 ? ` · verschil ${(d - c).toFixed(2)}` : " ✓"}</span></div></div>
      <ErrorBox error={error} /><DialogFooter><Button disabled={Math.abs(d - c) >= 0.005}>Boeken</Button></DialogFooter></form></DialogContent></Dialog>;
}

const KIND: Record<string, { label: string; variant: any; icon: any }> = { remark: { label: "Opmerking", variant: "secondary", icon: MessageSquareText }, finding: { label: "Bevinding", variant: "red", icon: AlertOctagon }, approved: { label: "Nagezien, in orde", variant: "success", icon: CheckCircle2 } };

export function EntryDialog({ entry, canReverse, onClose, onChanged }: { entry: Entry; canReverse: boolean; onClose: () => void; onChanged: () => void }) {
  const b = useBuilding(); const { user } = useAuth();
  const comments = useFetch<any[]>(`/api/buildings/${b.id}/ledger/entries/${entry.id}/comments`);
  const [body, setBody] = useState(""); const [kind, setKind] = useState("remark"); const [reason, setReason] = useState(""); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Boeking #{entry.number} · {fmtDate(entry.date)}</DialogTitle><DialogDescription>{entry.description}{entry.counterparty ? ` · ${entry.counterparty}` : ""} · {SOURCE[entry.source]}</DialogDescription></DialogHeader>
    <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Rekening</th><th className="py-1 text-right">Debet</th><th className="py-1 text-right">Credit</th></tr></thead><tbody>{entry.lines.map((l) => <tr key={l.id} className="border-t"><td className="py-1.5"><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.account_name}{l.unit_label ? <Badge variant="outline" className="ml-1">{l.unit_label}</Badge> : null}{l.memo ? <span className="ml-1 text-xs text-muted-foreground">({l.memo})</span> : null}</td><td className="py-1.5 text-right tabular-nums">{l.debit ? l.debit.toFixed(2) : ""}</td><td className="py-1.5 text-right tabular-nums">{l.credit ? l.credit.toFixed(2) : ""}</td></tr>)}</tbody></table>
    {entry.document_id && <a className="text-sm text-primary hover:underline" href={`/api/buildings/${b.id}/documents/${entry.document_id}/download?inline=1`} target="_blank" rel="noreferrer">📎 Verantwoordingsstuk: {entry.document_name}</a>}
    <div className="border-t pt-3"><h4 className="mb-2 text-sm font-medium">Controle & opmerkingen</h4>
      <div className="grid gap-2">{(comments.data ?? []).map((c) => { const K = KIND[c.kind]; return <div key={c.id} className="rounded-lg border p-2.5 text-sm"><div className="flex items-center gap-2"><UserAvatar name={c.author_name} className="size-6" /><span className="font-medium">{c.author_name}</span><RoleBadge role={c.author_role} /><Badge variant={K.variant}><K.icon />{K.label}</Badge><span className="ml-auto text-xs text-muted-foreground">{timeAgo(c.created_at)}</span></div><div className="mt-1.5 whitespace-pre-wrap">{c.body}</div></div>; })}{comments.data && !comments.data.length && <p className="text-xs text-muted-foreground">Nog geen opmerkingen.</p>}</div>
      {b.isBoard && <form className="mt-3 grid gap-2" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/entries/${entry.id}/comments`, { body, kind }); setBody(""); comments.reload(); } catch (err) { setError(err); } }}><div className="flex gap-2"><Select value={kind} onValueChange={setKind}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(KIND).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select><Input placeholder="Opmerking of bevinding…" required value={body} onChange={(e) => setBody(e.target.value)} /><Button size="sm">Toevoegen</Button></div></form>}</div>
    {canReverse && entry.status === "posted" && <form className="flex flex-wrap items-end gap-2 border-t pt-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/ledger/entries/${entry.id}/reverse`, { date: new Date().toISOString().slice(0, 10), reason }); toast.success("Tegengeboekt"); onChanged(); } catch (err) { setError(err); } }}><Field label="Tegenboeken (reden)" className="flex-1"><Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="bv. verkeerde rekening" /></Field><Button variant="outline" size="sm"><Undo2 />Tegenboeken</Button></form>}
    <ErrorBox error={error} /></DialogContent></Dialog>;
}
