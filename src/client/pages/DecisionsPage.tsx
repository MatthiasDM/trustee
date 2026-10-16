import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, FileText, Gavel, Scale } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { DocumentPicker } from "../ledger/DocumentPicker";

const VARIANT: Record<string, any> = { challengeable: "info", final: "success", challenged: "warning", annulled: "red", modified: "warning", awaiting_court: "red", court_refused: "red" };
const NONE = "__none__";

/** Beslissingenregister (art. 3.93 §4 BW): elke beslissing met datum, uitslag, tegenstemmers, termijnen en opvolging. */
export function DecisionsPage() {
  const b = useBuilding();
  const { data, loading, reload } = useFetch<{ items: any[]; kinds: Record<string, string> }>(`/api/buildings/${b.id}/decisions`);
  const [edit, setEdit] = useState<any>(null);
  const canEdit = b.isManager || b.role === "raad";
  return <div>
    <PageHeader title="Beslissingenregister" subtitle="Alle beslissingen van de algemene vergadering, ook schriftelijke (art. 3.93 §4 BW). Elke mede-eigenaar kan een beslissing binnen 4 maanden na de vergadering laten vernietigen of wijzigen als ze onregelmatig, bedrieglijk of onrechtmatig is en hem persoonlijk nadeel oplevert (art. 3.92 §3); bewoners zonder stemrecht binnen 2 maanden na kennisgeving en uiterlijk 4 maanden (art. 3.93 §5)."
      actions={<Button variant="outline" asChild><a href={`/api/buildings/${b.id}/decisions.csv`}><Download />CSV</a></Button>} />
    {loading || !data ? <Spinner /> : !data.items.length ? <Empty icon={<Gavel />} title="Nog geen beslissingen" hint="Beslissingen verschijnen hier zodra een stemming tijdens de AV is geregistreerd of een schriftelijk besluit is aangenomen." /> :
      <div className="space-y-3">{data.items.map((d) => <div key={d.id} className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1"><div className="text-xs text-muted-foreground">{fmtDate(d.decided_on)} · {d.meeting_title ?? "Algemene vergadering"} · {d.kind_label}</div><h3 className="font-semibold">{d.title}</h3></div>
          {d.adopted === 1 ? <Badge variant="success">aangenomen</Badge> : d.adopted === 0 ? <Badge variant="secondary">verworpen</Badge> : null}
          <Badge variant={VARIANT[d.status]}>{d.status_label}</Badge>
        </div>
        {d.decision && <p className="mt-2 text-sm whitespace-pre-wrap">{d.decision}</p>}
        {d.dissenters?.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Tegen: {d.dissenters.join(", ")}</p>}
        {d.hints.map((h: string) => <p key={h} className="mt-2 flex gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{h}</p>)}
        {d.challenge_status && <p className="mt-2 text-xs"><Scale className="mr-1 inline size-3.5" />Aanvechting{d.challenged_at ? ` ingesteld op ${fmtDate(d.challenged_at)}` : ""}: {({ pending: "lopend", rejected: "afgewezen", annulled: "beslissing vernietigd", modified: "beslissing gewijzigd" } as any)[d.challenge_status]}{d.challenge_note ? ` — ${d.challenge_note}` : ""}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          <span>Aanvechtbaar tot {fmtDate(d.challenge_until)}</span>
          {!d.written && <span className={d.minutes_late ? "text-amber-700 dark:text-amber-400" : ""}>Notulen {d.minutes_sent_at ? `verzonden ${fmtDate(d.minutes_sent_at)}` : "nog niet verzonden"} (uiterlijk {fmtDate(d.minutes_due)})</span>}
          {d.minutes_document_id && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/buildings/${b.id}/documents/${d.minutes_document_id}/download?inline=1`} target="_blank" rel="noreferrer"><FileText className="size-3.5" />Notulen</a>}
          {d.meeting_id && <Link className="text-primary hover:underline" to={`/b/${b.id}/meetings`}>Vergadering</Link>}
          {canEdit && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit(d)}>Opvolging</Button>}
        </div>
      </div>)}</div>}
    {edit && <FollowUpDialog d={edit} kinds={data?.kinds ?? {}} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
  </div>;
}

function FollowUpDialog({ d, kinds, onClose, onDone }: { d: any; kinds: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ kind: d.kind, adopted: d.adopted === null ? NONE : String(d.adopted), challenge_status: d.challenge_status ?? NONE, challenged_at: d.challenged_at ?? "", challenge_note: d.challenge_note ?? "", challenge_document_id: "", court_status: d.court_status ?? NONE, court_filed_at: d.court_filed_at ?? "", court_ruling_at: d.court_ruling_at ?? "" });
  const [error, setError] = useState<unknown>(null);
  const save = async () => { setError(null); try { await api.patch(`/api/buildings/${b.id}/decisions/${d.id}`, { kind: f.kind, adopted: f.adopted === NONE ? null : f.adopted === "1", challenge_status: f.challenge_status === NONE ? null : f.challenge_status, challenged_at: f.challenged_at || null, challenge_note: f.challenge_note || null, challenge_document_id: f.challenge_document_id || null, court_status: f.court_status === NONE ? null : f.court_status, court_filed_at: f.court_filed_at || null, court_ruling_at: f.court_ruling_at || null }); toast.success("Register bijgewerkt"); onDone(); } catch (e) { setError(e); } };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Opvolging: {d.title}</DialogTitle><DialogDescription>Registreer de soort beslissing en elke procedure bij de rechter. Wijzigingen worden gelogd.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Soort"><Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kinds).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Uitslag"><Select value={f.adopted} onValueChange={(v) => setF({ ...f, adopted: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>onbekend</SelectItem><SelectItem value="1">aangenomen</SelectItem><SelectItem value="0">verworpen</SelectItem></SelectContent></Select></Field>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Aanvechting (art. 3.92 §3)"><Select value={f.challenge_status} onValueChange={(v) => setF({ ...f, challenge_status: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>geen</SelectItem><SelectItem value="pending">lopend</SelectItem><SelectItem value="rejected">afgewezen</SelectItem><SelectItem value="annulled">vernietigd</SelectItem><SelectItem value="modified">gewijzigd</SelectItem></SelectContent></Select></Field>
      <Field label="Ingesteld op"><Input type="date" value={f.challenged_at} onChange={(e) => setF({ ...f, challenged_at: e.target.value })} /></Field>
    </div>
    <Field label="Toelichting"><Textarea value={f.challenge_note} onChange={(e) => setF({ ...f, challenge_note: e.target.value })} placeholder="bv. vordering van eigenaar kavel B2 bij het vredegerecht Oostende, rolnummer …" /></Field>
    {f.challenge_status !== NONE && <Field label="Dagvaarding of vonnis"><DocumentPicker value={f.challenge_document_id} onChange={(id) => setF({ ...f, challenge_document_id: id })} suggestedName={`Vonnis ${d.title}`} /></Field>}
    {(f.kind === "demolition" || d.needs_court) && <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3"><p className="text-xs text-muted-foreground sm:col-span-3">Volledige afbraak en heropbouw zonder eenparigheid: procedure van de VME bij de vrederechter (art. 3.92 §1).</p>
      <Field label="Procedure"><Select value={f.court_status} onValueChange={(v) => setF({ ...f, court_status: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>nog niet ingeleid</SelectItem><SelectItem value="filed">ingeleid</SelectItem><SelectItem value="approved">wettig verklaard</SelectItem><SelectItem value="refused">niet wettig verklaard</SelectItem></SelectContent></Select></Field>
      <Field label="Ingeleid op"><Input type="date" value={f.court_filed_at} onChange={(e) => setF({ ...f, court_filed_at: e.target.value })} /></Field>
      <Field label="Vonnis op"><Input type="date" value={f.court_ruling_at} onChange={(e) => setF({ ...f, court_ruling_at: e.target.value })} /></Field>
    </div>}
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button onClick={save}>Opslaan</Button></DialogFooter>
  </DialogContent></Dialog>;
}
