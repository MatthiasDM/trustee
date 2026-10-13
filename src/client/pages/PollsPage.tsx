import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, CheckCircle2, Download, Paperclip, Plus, Trash2, Vote, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, PageHeader, Spinner, StatusBadge } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Separator } from "../components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDateTime } from "../lib/api";
import { MAJORITY_LABELS, type Poll, type PollDocument } from "../../shared/types";
import { DocumentRefList, DocumentRefs } from "../components/DocumentRefs";
import { cn } from "@/lib/utils";
import { useT } from "../lib/i18n";

export function PollsPage() {
  const b = useBuilding(); const t = useT();
  const polls = useFetch<any[]>(`/api/buildings/${b.id}/polls`);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return <div>
    <PageHeader title={t("Stemmingen & peilingen")} subtitle={t("Gewogen stemmen volgens quotiteiten, of eenvoudige peilingen.")} actions={b.isBoard && <Button onClick={() => setOpen(true)}><Plus />{t("Nieuwe stemming")}</Button>} />
    {polls.loading ? <Spinner /> : !polls.data?.length ? <Empty icon={<Vote />} title={t("Nog geen stemmingen")} /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{polls.data.map((p) => <Link key={p.id} to={`/b/${b.id}/polls/${p.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-muted/50">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Vote className="size-4" /></div>
        <div className="min-w-0 flex-1"><div className="text-sm font-medium">{p.title}</div><div className="mt-0.5 text-xs text-muted-foreground">{p.written ? "Schriftelijk besluit (eenparigheid)" : p.weighted ? "Gewogen" : "1 stem p.p."} · {MAJORITY_LABELS[p.required_majority as keyof typeof MAJORITY_LABELS]} · {p.total_voters} gestemd{p.closes_at ? ` · sluit ${fmtDateTime(p.closes_at)}` : ""}</div></div>
        <div className="flex items-center gap-2">{p.status === "open" && (p.voted ? <Badge variant="success"><Check />{t("gestemd")}</Badge> : <Badge variant="warning">{t("nog stemmen")}</Badge>)}<StatusBadge status={p.status} /></div>
      </Link>)}</div>}
    {open && <NewPollModal onClose={() => setOpen(false)} onDone={(id) => nav(`/b/${b.id}/polls/${id}`)} />}
  </div>;
}

function NewPollModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ title: "", description: "", weighted: true, anonymous: false, multiple: false, owners_only: true, required_majority: "simple", closes_at: "", status: "open", written: false });
  const [options, setOptions] = useState(["Ja", "Nee", "Onthouding"]);
  const [docIds, setDocIds] = useState<string[]>([]); const [docs, setDocs] = useState<PollDocument[]>([]);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api.post<{ id: string }>(`/api/buildings/${b.id}/polls`, { ...f, options: options.filter((o) => o.trim()), document_ids: docIds, closes_at: f.closes_at ? new Date(f.closes_at).toISOString() : null }); onDone(r.id); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const Check_ = ({ k, label }: { k: "weighted" | "anonymous" | "multiple" | "owners_only"; label: string }) => <label className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={f[k]} onCheckedChange={(v) => setF({ ...f, [k]: !!v })} />{label}</label>;
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Nieuwe stemming</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Onderwerp / agendapunt"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bv. Goedkeuring offerte dakrenovatie (€ 48.500)" /></Field>
      <Field label="Toelichting"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Documenten bij deze stemming" hint="Offertes, verslagen of andere stukken waarover gestemd wordt; stemmers openen ze rechtstreeks vanuit de stemming."><DocumentRefs value={docIds} docs={docs} onChange={(ids, ds) => { setDocIds(ids); setDocs(ds); }} /></Field>
      <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm"><Checkbox checked={f.written} onCheckedChange={(v) => setF({ ...f, written: !!v })} /><span><span className="font-medium">Schriftelijke besluitvorming</span> (art. 3.87 §11 BW): besluit zonder vergadering, enkel geldig als <strong>alle</strong> mede-eigenaars "Akkoord" stemmen. Eén "Niet akkoord" verwerpt het; het punt kan dan op een AV. Opties en meerderheid worden vastgelegd.</span></label>
      {!f.written && <Field label="Opties"><div className="grid gap-2">{options.map((o, i) => <div key={i} className="flex gap-2"><Input value={o} onChange={(e) => setOptions(options.map((x, j) => j === i ? e.target.value : x))} />{options.length > 2 && <Button type="button" variant="ghost" size="icon" onClick={() => setOptions(options.filter((_, j) => j !== i))}><X /></Button>}</div>)}<Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOptions([...options, ""])}><Plus />Optie</Button></div></Field>}
      {!f.written && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vereiste meerderheid"><Select value={f.required_majority} onValueChange={(v) => setF({ ...f, required_majority: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MAJORITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Sluit op (optioneel)"><Input type="datetime-local" value={f.closes_at} onChange={(e) => setF({ ...f, closes_at: e.target.value })} /></Field>
      </div>}
      {!f.written && <div className="grid gap-x-6 sm:grid-cols-2"><Check_ k="weighted" label="Gewogen volgens quotiteiten (aandelen)" /><Check_ k="owners_only" label="Enkel mede-eigenaars" /><Check_ k="anonymous" label="Anoniem (namen verborgen)" /><Check_ k="multiple" label="Meerdere keuzes toegestaan" /></div>}
      <Field label="Status"><Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Direct openen (leden worden verwittigd)</SelectItem><SelectItem value="draft">Opslaan als concept</SelectItem></SelectContent></Select></Field>
      <ErrorBox error={error} />
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={busy}>Aanmaken</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function PollDetailPage() {
  const b = useBuilding();
  const { pollId } = useParams();
  const nav = useNavigate();
  const { data: p, loading, reload, setData } = useFetch<Poll & { can_vote: boolean }>(`/api/buildings/${b.id}/polls/${pollId}`);
  const [sel, setSel] = useState<string[]>([]); const [error, setError] = useState<unknown>(null);
  const [editDocs, setEditDocs] = useState<{ ids: string[]; docs: PollDocument[] } | null>(null);
  if (loading || !p) return <Spinner />;
  const voted = (p.my_votes ?? []).length > 0;
  const showResults = p.options?.some((o) => o.votes !== undefined);
  const total = p.total_weight || 0;
  const threshold = { simple: 0.5, two_thirds: 2 / 3, four_fifths: 0.8, unanimous: 1, none: 0 }[p.required_majority];
  const vote = async () => { setError(null); try { setData(await api.post(`/api/buildings/${b.id}/polls/${p.id}/vote`, { option_ids: sel })); toast.success("Je stem is geregistreerd"); } catch (err) { setError(err); } };
  const setStatus = async (status: string) => { await api.patch(`/api/buildings/${b.id}/polls/${p.id}`, { status }); reload(); };
  const toggle = (id: string) => setSel(p.multiple ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id]);
  const top = p.options && total > 0 ? [...p.options].sort((a, c) => (c.weight ?? 0) - (a.weight ?? 0))[0] : null;
  const reached = top ? (threshold === 1 ? (top.weight ?? 0) === total : (top.weight ?? 0) / total > threshold) : false;
  return <div className="max-w-3xl">
    <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3"><Link to={`/b/${b.id}/polls`}><ArrowLeft />Terug</Link></Button>
    <div className="rounded-xl border bg-card p-6 shadow-xs">
      <div className="flex items-start justify-between gap-3"><h1 className="text-xl font-semibold tracking-tight">{p.title}</h1><StatusBadge status={p.status} /></div>
      <div className="mt-1.5 text-xs text-muted-foreground">{p.weighted ? "Gewogen volgens quotiteiten" : "1 stem per persoon"} · {MAJORITY_LABELS[p.required_majority]} · {p.anonymous ? "anoniem" : "namen zichtbaar"} · door {p.created_by_name}{p.closes_at ? ` · sluit ${fmtDateTime(p.closes_at)}` : ""}</div>
      {p.description && <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap">{p.description}</p>}
      {((p.documents?.length ?? 0) > 0 || (b.isBoard && p.status !== "closed")) && <div className="mt-4 rounded-lg border bg-muted/30 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2"><div className="flex items-center gap-1.5 text-sm font-medium"><Paperclip className="size-4 text-muted-foreground" />Documenten bij deze stemming</div>{b.isBoard && p.status !== "closed" && !editDocs && <Button size="sm" variant="ghost" onClick={() => setEditDocs({ ids: (p.documents ?? []).map((d) => d.id), docs: p.documents ?? [] })}>Wijzigen</Button>}</div>
        {editDocs ? <div className="grid gap-2"><DocumentRefs value={editDocs.ids} docs={editDocs.docs} onChange={(ids, docs) => setEditDocs({ ids, docs })} /><div className="flex gap-2"><Button size="sm" onClick={async () => { await api.patch(`/api/buildings/${b.id}/polls/${p.id}`, { document_ids: editDocs.ids }); setEditDocs(null); reload(); toast.success("Documenten bijgewerkt"); }}>Opslaan</Button><Button size="sm" variant="outline" onClick={() => setEditDocs(null)}>Annuleren</Button></div></div>
          : p.documents?.length ? <DocumentRefList docs={p.documents} /> : <p className="text-sm text-muted-foreground">Nog geen documenten gekoppeld.</p>}
      </div>}
      {(p as any).written === 1 && (p as any).written_progress && <div className={`mt-4 rounded-lg border p-3 text-sm ${(p as any).outcome === "adopted" ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20" : (p as any).outcome === "rejected" ? "border-red-300 bg-red-50/50 dark:bg-red-950/20" : "bg-muted/30"}`}><div className="font-medium">Schriftelijke besluitvorming (art. 3.87 §11)</div><div className="text-muted-foreground">{(p as any).written_progress.agreed} van {(p as any).written_progress.total} mede-eigenaars akkoord{(p as any).written_progress.disagreed ? `, ${(p as any).written_progress.disagreed} niet akkoord` : ""}. {(p as any).outcome === "adopted" ? "Eenparig aangenomen: het besluit is genomen zonder vergadering en staat bij de beslissingen." : (p as any).outcome === "rejected" ? "Verworpen: niet alle mede-eigenaars gaan akkoord; agendeer het punt op een AV." : "Geldig zodra iedereen akkoord is."}</div></div>}

      <div className="mt-6 grid gap-2">{p.options?.map((o) => {
        const pct = showResults && total > 0 ? ((o.weight ?? 0) / total) * 100 : 0;
        const mine = p.my_votes?.includes(o.id);
        const selected = sel.includes(o.id);
        return <div key={o.id} role={p.can_vote ? "button" : undefined} className={cn("relative overflow-hidden rounded-lg border p-3 transition", selected && "border-primary ring-2 ring-primary/30", p.can_vote && "cursor-pointer hover:border-primary/60")} onClick={() => p.can_vote && toggle(o.id)}>
          {showResults && <div className="absolute inset-y-0 left-0 bg-primary/10 transition-all" style={{ width: `${pct}%` }} />}
          <div className="relative flex items-center gap-3">
            {p.can_vote && <span className={cn("flex size-4 shrink-0 items-center justify-center border", p.multiple ? "rounded-[4px]" : "rounded-full", selected ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{selected && <Check className="size-3" />}</span>}
            <span className="flex-1 text-sm font-medium">{o.label}{mine ? <Check className="ml-1.5 inline size-3.5 text-primary" /> : null}</span>
            {showResults && <span className="text-sm tabular-nums">{pct.toFixed(1)}% <span className="text-xs text-muted-foreground">({o.votes}{p.weighted ? ` · ${o.weight?.toFixed(0)} aand.` : ""})</span></span>}</div>
          {showResults && !p.anonymous && o.voters?.length ? <div className="relative mt-1 text-xs text-muted-foreground">{o.voters.join(", ")}</div> : null}
        </div>; })}</div>

      {showResults && <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3"><div className="text-lg font-semibold tabular-nums">{p.total_voters}/{p.eligible_voters}</div><div className="text-xs text-muted-foreground">stemmers</div></div>
        {p.weighted ? <div className="rounded-lg border p-3"><div className="text-lg font-semibold tabular-nums">{total.toFixed(0)}/{p.eligible_weight}</div><div className="text-xs text-muted-foreground">aandelen vertegenwoordigd ({p.eligible_weight ? ((total / p.eligible_weight) * 100).toFixed(0) : 0}%)</div></div> : null}
        {threshold > 0 && top && <div className={cn("rounded-lg border p-3", reached ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20")}><div className="flex items-center gap-1.5 text-lg font-semibold">{reached ? <CheckCircle2 className="size-5 text-emerald-600" /> : <XCircle className="size-5 text-amber-600" />}{reached ? "Gehaald" : "Niet gehaald"}</div><div className="text-xs text-muted-foreground">“{top.label}” t.o.v. {MAJORITY_LABELS[p.required_majority].toLowerCase()}</div></div>}
      </div>}

      {p.can_vote && <div className="mt-5 flex items-center gap-3"><Button disabled={!sel.length} onClick={vote}>{voted ? "Stem wijzigen" : "Stem uitbrengen"}</Button>{voted && <span className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><Check className="size-4" />Je hebt gestemd</span>}</div>}
      {!p.can_vote && p.status === "open" && <p className="mt-4 text-sm text-muted-foreground">Je bent niet stemgerechtigd voor deze stemming.</p>}
      <div className="mt-3"><ErrorBox error={error} /></div>
      {b.isBoard && <><Separator className="my-5" /><div className="flex flex-wrap gap-2">
        {p.status === "draft" && <Button size="sm" onClick={() => setStatus("open")}>Openen & verwittigen</Button>}
        {p.status === "open" && <Button size="sm" variant="outline" onClick={() => confirm("Stemming afsluiten?") && setStatus("closed")}>Afsluiten</Button>}
        <Button size="sm" variant="outline" asChild><a href={`/api/buildings/${b.id}/polls/${p.id}/export.csv`}><Download />CSV export</a></Button>
        {b.isManager && <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={async () => { if (confirm("Stemming verwijderen?")) { await api.del(`/api/buildings/${b.id}/polls/${p.id}`); nav(`/b/${b.id}/polls`); } }}><Trash2 />Verwijderen</Button>}
      </div></>}
    </div>
  </div>;
}
