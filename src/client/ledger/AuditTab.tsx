import { useState, type FormEvent } from "react";
import { ClipboardCheck, FileText, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { FiscalYear } from "./shared";

const CONCL: Record<string, { label: string; variant: any }> = { approve: { label: "Goedkeuring en kwijting", variant: "success" }, approve_with_remarks: { label: "Goedkeuring met opmerkingen", variant: "warning" }, reject: { label: "Kwijting uitstellen", variant: "red" } };

/** Verslag van de commissaris van de rekeningen (art. 3.91 BW): opstellen, definitief maken, agenderen. */
export function AuditTab({ fys }: { fys: FiscalYear[] }) {
  const b = useBuilding(); const { user } = useAuth();
  const { data, loading, reload } = useFetch<any[]>(`/api/buildings/${b.id}/ledger/commissioner-reports`);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const canWrite = b.role === "commissaris" || b.isManager;
  if (loading || !data) return <Spinner />;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-sm text-muted-foreground">De commissaris controleert de rekeningen en rapporteert aan de algemene vergadering, die daarna over de goedkeuring en de kwijting van de syndicus stemt. Een definitief verslag wordt als PDF bewaard en automatisch als agendapunt voorgesteld.</p>{canWrite && <Button onClick={() => setEdit("new")}><Plus />Verslag opstellen</Button>}</div>
    {!data.length ? <Empty icon={<ClipboardCheck />} title="Nog geen controleverslag" /> : <div className="divide-y rounded-xl border bg-card shadow-xs">{data.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"><div className="min-w-0 flex-1"><div className="font-medium">Boekjaar {r.fy_label} · {fmtDate(r.period_from)} – {fmtDate(r.period_to)}</div><div className="text-xs text-muted-foreground">{r.author_name}{r.finalized_at ? ` · definitief op ${fmtDate(r.finalized_at)}` : " · ontwerp"}</div></div><Badge variant={CONCL[r.conclusion].variant}>{CONCL[r.conclusion].label}</Badge>{r.status === "final" ? <Button size="sm" variant="outline" asChild><a href={`/api/buildings/${b.id}/documents/${r.document_id}/download?inline=1`} target="_blank" rel="noreferrer"><FileText />PDF</a></Button> : (r.author_id === user?.id || b.isManager) && <Button size="sm" variant="outline" onClick={() => setEdit(r)}>Bewerken</Button>}</div>)}</div>}
    {edit && <ReportDialog report={edit === "new" ? null : edit} fys={fys} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
  </div>;
}

function ReportDialog({ report, fys, onClose, onDone }: { report: any; fys: FiscalYear[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding(); const { user } = useAuth();
  const fy0 = fys.find((f) => f.id === report?.fiscal_year_id) ?? fys[0];
  const [f, setF] = useState({ fiscal_year_id: fy0?.id ?? "", period_from: report?.period_from ?? fy0?.start_date ?? "", period_to: report?.period_to ?? fy0?.end_date ?? "", scope: report?.scope ?? "", findings: report?.findings ?? "", conclusion: report?.conclusion ?? "approve", recommendation: report?.recommendation ?? "" });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const save = async (): Promise<string> => { const body = { ...f, scope: f.scope || null, findings: f.findings || null, recommendation: f.recommendation || null }; if (report) { await api.patch(`/api/buildings/${b.id}/ledger/commissioner-reports/${report.id}`, body); return report.id; } const r = await api.post<{ id: string }>(`/api/buildings/${b.id}/ledger/commissioner-reports`, body); return r.id; };
  const canFinalize = !report || report.author_id === user?.id;
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Verslag van de commissaris van de rekeningen</DialogTitle><DialogDescription>Enkel de commissaris die het verslag opstelt kan het definitief maken.</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await save(); toast.success("Ontwerp bewaard"); onDone(); } catch (err) { setError(err); } finally { setBusy(false); } }}>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Boekjaar"><Select value={f.fiscal_year_id} onValueChange={(v) => { const fy = fys.find((x) => x.id === v); setF({ ...f, fiscal_year_id: v, period_from: fy?.start_date ?? f.period_from, period_to: fy?.end_date ?? f.period_to }); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{fys.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Periode van"><Input type="date" required value={f.period_from} onChange={(e) => setF({ ...f, period_from: e.target.value })} /></Field><Field label="tot"><Input type="date" required value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} /></Field></div>
      <Field label="Omvang van de controle" hint="Wat werd nagekeken: dagboek, verantwoordingsstukken, bankuittreksels, oproepen, afrekening."><Textarea value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
      <Field label="Vaststellingen"><Textarea className="min-h-32" value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
      <Field label="Besluit"><Select value={f.conclusion} onValueChange={(v) => setF({ ...f, conclusion: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CONCL).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Advies aan de algemene vergadering"><Textarea value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })} /></Field>
      <ErrorBox error={error} />
      <DialogFooter><Button variant="outline" disabled={busy}>Ontwerp bewaren</Button>{canFinalize && <Button type="button" disabled={busy} onClick={async () => { if (!confirm("Verslag definitief maken? Het wordt als PDF bewaard, aan alle leden gemeld en als agendapunt voorgesteld.")) return; setBusy(true); setError(null); try { const id = await save(); await api.post(`/api/buildings/${b.id}/ledger/commissioner-reports/${id}/finalize`); toast.success("Verslag definitief en geagendeerd"); onDone(); } catch (err) { setError(err); } finally { setBusy(false); } }}><Send />Definitief maken</Button>}</DialogFooter></form></DialogContent></Dialog>;
}
