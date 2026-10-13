import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, Info } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { Empty, ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, fmtDate } from "../lib/api";
import { ORGAN_LABELS, type Mandate, type Member, type Organ } from "../../shared/types";

const NONE = "__none__";

export function MandatesTab({ members, meetings }: { members: Member[]; meetings: { id: string; title: string; starts_at: string }[] }) {
  const b = useBuilding();
  const { data, reload } = useFetch<{ mandates: Mandate[]; rules: Record<Organ, { label: string; maxYears: number | null; basis: string }>; raad_required: boolean; counted_units: number }>(`/api/buildings/${b.id}/mandates`);
  const [edit, setEdit] = useState<Mandate | null | "new">(null);
  if (!data) return null;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const state = (m: Mandate) => m.end_date < today ? { label: "Afgelopen", variant: "outline" as const } : m.start_date > today ? { label: "Toekomstig", variant: "secondary" as const } : m.end_date <= soon ? { label: "Loopt binnenkort af", variant: "warning" as const } : { label: "Actief", variant: "success" as const };
  return <div>
    <div className="mb-4 grid gap-3 sm:grid-cols-3">{(Object.keys(data.rules) as Organ[]).map((o) => <div key={o} className="rounded-lg border bg-muted/30 p-3 text-xs"><div className="mb-1 text-sm font-medium">{data.rules[o].label}</div><div className="text-muted-foreground">{data.rules[o].basis}</div>{o === "raad" && <div className="mt-1 text-muted-foreground">Dit gebouw: {data.counted_units} meetellende kavels → {data.raad_required ? "verplicht" : "facultatief"}.</div>}</div>)}</div>
    <div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Info className="size-4" />Mandaten worden toegekend door de algemene vergadering; registreer hier de beslissing.</p>{b.isBoard && <Button onClick={() => setEdit("new")}><Plus />Mandaat registreren</Button>}</div>
    {!data.mandates.length ? <Empty title="Nog geen mandaten geregistreerd" /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{data.mandates.map((m) => { const st = state(m); return <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <div className="min-w-0 flex-1"><div className="font-medium">{m.user_name ?? m.holder_name}{m.function_title ? <span className="text-muted-foreground"> · {m.function_title}</span> : null}</div><div className="text-xs text-muted-foreground">{ORGAN_LABELS[m.organ]} · {fmtDate(m.start_date)} → {fmtDate(m.end_date)}{m.meeting_title ? ` · benoemd op ${m.meeting_title}` : ""}{!m.user_id ? " · extern (geen account)" : ""}</div>{m.notes && <div className="mt-0.5 text-xs text-muted-foreground">{m.notes}</div>}</div>
        <Badge variant={st.variant}>{st.label}</Badge>
        {b.isBoard && <Button size="icon-sm" variant="ghost" onClick={() => setEdit(m)}><Pencil /></Button>}
        {b.isManager && <Button size="icon-sm" variant="ghost" onClick={async () => { if (confirm("Mandaat verwijderen?")) { await api.del(`/api/buildings/${b.id}/mandates/${m.id}`); reload(); } }}><Trash2 /></Button>}
      </div>; })}</div>}
    <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}><DialogContent><DialogHeader><DialogTitle>{edit === "new" ? "Mandaat registreren" : "Mandaat bewerken"}</DialogTitle><DialogDescription>De wettelijke maximumduur wordt gecontroleerd.</DialogDescription></DialogHeader>{edit && <MandateForm mandate={edit === "new" ? null : edit} members={members} meetings={meetings} onDone={() => { setEdit(null); reload(); toast.success("Mandaat opgeslagen"); }} />}</DialogContent></Dialog>
  </div>;
}

function MandateForm({ mandate, members, meetings, onDone }: { mandate: Mandate | null; members: Member[]; meetings: { id: string; title: string; starts_at: string }[]; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ organ: mandate?.organ ?? "commissaris", user_id: mandate?.user_id ?? "", holder_name: mandate?.holder_name ?? "", function_title: mandate?.function_title ?? "", start_date: mandate?.start_date ?? new Date().toISOString().slice(0, 10), end_date: mandate?.end_date ?? "", appointed_by_meeting_id: mandate?.appointed_by_meeting_id ?? "", notes: mandate?.notes ?? "" });
  const [error, setError] = useState<unknown>(null);
  const eligible = members.filter((m) => f.organ === "raad" ? m.role !== "huurder" : true);
  return <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); const body = { ...f, user_id: f.user_id || null, holder_name: f.holder_name || null, function_title: f.function_title || null, appointed_by_meeting_id: f.appointed_by_meeting_id || null, notes: f.notes || null }; try { if (mandate) await api.patch(`/api/buildings/${b.id}/mandates/${mandate.id}`, body); else await api.post(`/api/buildings/${b.id}/mandates`, body); onDone(); } catch (err) { setError(err); } }}>
    <Field label="Orgaan"><Select value={f.organ} onValueChange={(v) => setF({ ...f, organ: v as Organ })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ORGAN_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Lid van het platform" hint={f.organ === "raad" ? "Enkel stemgerechtigde mede-eigenaars (art. 3.90 BW)." : "Laat leeg voor een externe (bv. accountant of syndicuskantoor) en vul hieronder de naam in."}><Select value={f.user_id || NONE} onValueChange={(v) => setF({ ...f, user_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>— extern / geen account —</SelectItem>{eligible.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select></Field>
    {!f.user_id && <Field label="Naam (extern)"><Input value={f.holder_name} onChange={(e) => setF({ ...f, holder_name: e.target.value })} placeholder="bv. Accountantskantoor Dewulf" /></Field>}
    <Field label="Functie (optioneel)"><Input value={f.function_title} onChange={(e) => setF({ ...f, function_title: e.target.value })} placeholder="bv. Voorzitter raad" /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Start"><Input type="date" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field><Field label="Einde"><Input type="date" required value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field></div>
    <Field label="Benoemd op (AV)"><Select value={f.appointed_by_meeting_id || NONE} onValueChange={(v) => setF({ ...f, appointed_by_meeting_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>— niet gekoppeld —</SelectItem>{meetings.map((m) => <SelectItem key={m.id} value={m.id}>{m.title} · {fmtDate(m.starts_at)}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Notities"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    <ErrorBox error={error} /><DialogFooter><Button>Opslaan</Button></DialogFooter>
  </form>;
}
