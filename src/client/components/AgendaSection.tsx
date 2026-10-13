import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarCheck, Gavel, Info, ListPlus, Trash2, Undo2, Vote } from "lucide-react";
import { VoteDialog } from "./MeetingTools";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MAJORITY_LABELS, type AgendaItem, type PollDocument } from "../../shared/types";
import { DocumentRefs } from "./DocumentRefs";

const STATUS: Record<string, { label: string; variant: any }> = { proposed: { label: "Voorgesteld", variant: "info" }, scheduled: { label: "Geagendeerd", variant: "secondary" }, decided: { label: "Beslist", variant: "success" }, deferred: { label: "Uitgesteld", variant: "warning" }, withdrawn: { label: "Ingetrokken", variant: "outline" } };

/** Agendapunten: voorstellen van mede-eigenaars (art. 3.87 §3) en de agenda per vergadering. */
export function AgendaSection({ meetings }: { meetings: { id: string; title: string; starts_at: string; type: string }[] }) {
  const b = useBuilding();
  const { user } = useAuth();
  const { data, reload } = useFetch<{ items: AgendaItem[]; deadline: string | null; periodStart: string | null }>(`/api/buildings/${b.id}/agenda`);
  const [propose, setPropose] = useState(false);
  const [pollFor, setPollFor] = useState<AgendaItem | null>(null);
  if (!data) return null;
  const proposed = data.items.filter((i) => i.status === "proposed");
  const upcoming = meetings.filter((m) => new Date(m.starts_at) >= new Date()).sort((a, c) => a.starts_at.localeCompare(c.starts_at));
  const patch = async (id: string, body: any) => { await api.patch(`/api/buildings/${b.id}/agenda/${id}`, body); reload(); };
  const deadlinePassed = data.deadline ? new Date(data.deadline) < new Date() : false;

  return <div className="mb-8 rounded-xl border bg-card p-5 shadow-xs">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="flex items-center gap-2 font-semibold"><Gavel className="size-4 text-primary" />Agendapunten voor de algemene vergadering</h2>
        <p className="text-sm text-muted-foreground">Elke mede-eigenaar kan punten indienen. De syndicus moet ze agenderen (art. 3.87 §3 BW).{data.deadline && <> Indienen voor de gewone AV tot <strong>{fmtDate(data.deadline)}</strong> (3 weken vóór de AV-periode die start op {fmtDate(data.periodStart)}); latere voorstellen schuiven door naar de volgende AV.</>}</p></div>
      {(b.isOwner || b.isManager || b.role === "raad") && <Button onClick={() => setPropose(true)}><ListPlus />{b.isOwner ? "Agendapunt indienen" : "Punt agenderen"}</Button>}
    </div>
    {proposed.length > 0 && <div className="mb-4"><h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Voorgesteld, nog te agenderen ({proposed.length})</h3>
      <ul className="divide-y rounded-lg border">{proposed.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
        <div className="min-w-0 flex-1"><div className="font-medium">{i.title}</div><div className="text-xs text-muted-foreground">{i.submitted_by_name} · {fmtDate(i.created_at)} · {MAJORITY_LABELS[i.required_majority]}</div>{i.description && <div className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{i.description}</div>}</div>
        {b.isBoard && upcoming.length > 0 && <Select onValueChange={(v) => patch(i.id, { meeting_id: v })}><SelectTrigger size="sm"><SelectValue placeholder="Agenderen op…" /></SelectTrigger><SelectContent>{upcoming.map((m) => <SelectItem key={m.id} value={m.id}>{m.title} · {fmtDate(m.starts_at)}</SelectItem>)}</SelectContent></Select>}
        {b.isBoard && <Button size="sm" variant="ghost" onClick={() => patch(i.id, { status: "deferred" })}>Uitstellen</Button>}
        {(i.submitted_by === user?.id) && <Button size="sm" variant="ghost" onClick={() => patch(i.id, { status: "withdrawn" })}><Undo2 />Intrekken</Button>}
      </li>)}</ul></div>}
    {proposed.length === 0 && <p className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground"><Info className="size-4" />Geen openstaande voorstellen.</p>}
    {data.items.some((i) => i.status === "deferred") && <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">Uitgestelde punten ({data.items.filter((i) => i.status === "deferred").length})</summary><ul className="mt-2 divide-y rounded-lg border">{data.items.filter((i) => i.status === "deferred").map((i) => <li key={i.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1">{i.title}</span>{b.isBoard && <Button size="sm" variant="ghost" onClick={() => patch(i.id, { status: "proposed" })}>Terug naar voorstellen</Button>}</li>)}</ul></details>}

    <Dialog open={propose} onOpenChange={setPropose}><DialogContent><DialogHeader><DialogTitle>Agendapunt indienen</DialogTitle><DialogDescription>Je voorstel komt op de agenda van de volgende algemene vergadering.{deadlinePassed && " De termijn voor de eerstvolgende gewone AV is verstreken; het punt schuift door naar de daaropvolgende AV."}</DialogDescription></DialogHeader><ProposeForm onDone={() => { setPropose(false); reload(); toast.success("Agendapunt ingediend"); }} /></DialogContent></Dialog>
    <Dialog open={!!pollFor} onOpenChange={(o) => !o && setPollFor(null)}><DialogContent><DialogHeader><DialogTitle>Stemming aanmaken</DialogTitle><DialogDescription>Gewogen volgens aandelen, enkel mede-eigenaars. Meerderheid: {pollFor && MAJORITY_LABELS[pollFor.required_majority]}.</DialogDescription></DialogHeader>{pollFor && <PollFromItemForm item={pollFor} onDone={() => { setPollFor(null); reload(); }} />}</DialogContent></Dialog>
  </div>;
}

/** Agenda van één vergadering (geagendeerde punten, volgorde, stemming, beslissing). */
export function MeetingAgenda({ meetingId, meetingStartsAt }: { meetingId: string; meetingStartsAt?: string }) {
  const b = useBuilding();
  const { data, reload } = useFetch<{ items: AgendaItem[] }>(`/api/buildings/${b.id}/agenda?meeting=${meetingId}`);
  const [pollFor, setPollFor] = useState<AgendaItem | null>(null);
  const [decide, setDecide] = useState<AgendaItem | null>(null); const [voteFor, setVoteFor] = useState<AgendaItem | null>(null);
  if (!data || !data.items.length) return null;
  const items = [...data.items].sort((a, c) => a.position - c.position || a.created_at.localeCompare(c.created_at));
  const patch = async (id: string, body: any) => { await api.patch(`/api/buildings/${b.id}/agenda/${id}`, body); reload(); };
  const move = async (idx: number, dir: -1 | 1) => { const j = idx + dir; if (j < 0 || j >= items.length) return; await Promise.all([patch(items[idx].id, { position: j + 1 }), patch(items[j].id, { position: idx + 1 })]); };
  return <div className="mt-3">
    <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Agenda</h4>
    <ol className="divide-y rounded-lg border text-sm">{items.map((i, idx) => <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="w-5 text-right tabular-nums text-muted-foreground">{idx + 1}.</span>
      <div className="min-w-0 flex-1"><div className="font-medium">{i.title}</div><div className="text-xs text-muted-foreground">{MAJORITY_LABELS[i.required_majority]} · ingediend door {i.submitted_by_name}</div>{(i as any).voted_at && <div className="mt-0.5 flex flex-wrap gap-1 text-xs"><Badge variant="success">vóór {(i as any).votes_for}</Badge><Badge variant="red">tegen {(i as any).votes_against}</Badge><Badge variant="secondary">onth. {(i as any).votes_abstain}</Badge></div>}{i.decision && <div className="mt-0.5 text-xs"><span className="font-medium">Beslissing:</span> {i.decision}</div>}</div>
      <Badge variant={STATUS[i.status].variant}>{STATUS[i.status].label}</Badge>
      {i.poll_id ? <Button size="sm" variant="outline" asChild><Link to={`/b/${b.id}/polls/${i.poll_id}`}><Vote />{i.poll_status === "closed" ? "Resultaat" : "Stemmen"}</Link></Button> : b.isBoard && i.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => setPollFor(i)}><Vote />Stemming</Button>}
      {b.isBoard && (i.status === "scheduled" || (i as any).voted_at) && <Button size="sm" variant={i.status === "scheduled" ? "default" : "ghost"} onClick={() => setVoteFor(i)}><Gavel />{(i as any).voted_at ? "Stemming wijzigen" : "Stemmen (AV)"}</Button>}
      {b.isBoard && i.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => setDecide(i)}><CalendarCheck />Beslist</Button>}
      {b.isBoard && <div className="flex"><Button size="icon-sm" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp /></Button><Button size="icon-sm" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === items.length - 1}><ArrowDown /></Button><Button size="icon-sm" variant="ghost" onClick={() => patch(i.id, { meeting_id: null, status: "proposed" })} title="Van agenda halen"><Trash2 /></Button></div>}
    </li>)}</ol>
    <Dialog open={!!pollFor} onOpenChange={(o) => !o && setPollFor(null)}><DialogContent><DialogHeader><DialogTitle>Stemming aanmaken</DialogTitle><DialogDescription>Gewogen volgens aandelen, enkel mede-eigenaars. Meerderheid: {pollFor && MAJORITY_LABELS[pollFor.required_majority]}.</DialogDescription></DialogHeader>{pollFor && <PollFromItemForm item={pollFor} onDone={() => { setPollFor(null); reload(); }} />}</DialogContent></Dialog>
    {voteFor && <VoteDialog meetingId={meetingId} item={voteFor} onClose={() => setVoteFor(null)} onDone={() => { setVoteFor(null); reload(); }} />}
    <Dialog open={!!decide} onOpenChange={(o) => !o && setDecide(null)}><DialogContent><DialogHeader><DialogTitle>Beslissing noteren</DialogTitle></DialogHeader>{decide && <DecisionForm item={decide} onDone={() => { setDecide(null); reload(); }} />}</DialogContent></Dialog>
  </div>;
}

function ProposeForm({ onDone }: { onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ title: "", description: "", required_majority: "simple" });
  const [error, setError] = useState<unknown>(null);
  return <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/agenda`, f); onDone(); } catch (err) { setError(err); } }}>
    <Field label="Agendapunt"><Input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bv. Plaatsen van laadpalen in de garage" /></Field>
    <Field label="Toelichting"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    <Field label="Vereiste meerderheid (art. 3.88 BW)" hint="Volstrekte meerderheid tenzij de wet anders bepaalt: 2/3 voor werken aan gemene delen, 4/5 voor statutenwijzigingen en bestemmingswijzigingen, eenparigheid voor wijziging van de aandelen."><Select value={f.required_majority} onValueChange={(v) => setF({ ...f, required_majority: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MAJORITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field>
    <ErrorBox error={error} /><DialogFooter><Button>Indienen</Button></DialogFooter>
  </form>;
}

function PollFromItemForm({ item, onDone }: { item: AgendaItem; onDone: () => void }) {
  const b = useBuilding();
  const [options, setOptions] = useState("Voor\nTegen\nOnthouding"); const [closes, setCloses] = useState(""); const [error, setError] = useState<unknown>(null);
  const [docIds, setDocIds] = useState<string[]>([]); const [docs, setDocs] = useState<PollDocument[]>([]);
  return <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/agenda/${item.id}/poll`, { options: options.split("\n").map((s) => s.trim()).filter(Boolean), closes_at: closes ? new Date(closes).toISOString() : null, document_ids: docIds }); toast.success("Stemming geopend"); onDone(); } catch (err) { setError(err); } }}>
    <Field label="Opties (één per lijn)"><Textarea value={options} onChange={(e) => setOptions(e.target.value)} /></Field>
    <Field label="Sluit op (optioneel)"><Input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></Field>
    <Field label="Documenten bij deze stemming" hint="Bv. de offertes waarover gestemd wordt."><DocumentRefs value={docIds} docs={docs} onChange={(ids, ds) => { setDocIds(ids); setDocs(ds); }} /></Field>
    <ErrorBox error={error} /><DialogFooter><Button>Stemming openen</Button></DialogFooter>
  </form>;
}

function DecisionForm({ item, onDone }: { item: AgendaItem; onDone: () => void }) {
  const b = useBuilding();
  const [decision, setDecision] = useState(item.decision ?? "");
  return <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.patch(`/api/buildings/${b.id}/agenda/${item.id}`, { status: "decided", decision }); onDone(); }}>
    <Field label="Beslissing van de algemene vergadering" hint="bv. Goedgekeurd met 720/1000 aandelen (2/3 vereist)."><Textarea required value={decision} onChange={(e) => setDecision(e.target.value)} /></Field>
    <DialogFooter><Button>Opslaan</Button></DialogFooter>
  </form>;
}
