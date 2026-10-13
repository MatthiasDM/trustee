import { useState, type FormEvent } from "react";
import { Calendar, CalendarPlus, Check, FileText, MapPin, Pencil, ScrollText, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { AgendaSection, MeetingAgenda } from "../components/AgendaSection";
import { AttendancePanel, MinutesDialog, ProxyDialog } from "../components/MeetingTools";
import { MeetingRequests } from "../components/MeetingRequests";
import { Empty, ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "../components/ui/table";
import { api, fmtDateTime } from "../lib/api";
import type { Doc } from "../../shared/types";
import { useT } from "../lib/i18n";

const TYPE: Record<string, string> = { av: "Algemene vergadering", bav: "Bijzondere algemene vergadering", raad: "Raad van mede-eigendom" };
const NONE = "__none__";

export function MeetingsPage() {
  const b = useBuilding(); const t = useT();
  const meetings = useFetch<any[]>(`/api/buildings/${b.id}/meetings`);
  const [open, setOpen] = useState(false); const [edit, setEdit] = useState<any>(null); const [rsvps, setRsvps] = useState<any>(null);
  const [proxyFor, setProxyFor] = useState<string | null>(null); const [minutesFor, setMinutesFor] = useState<any>(null); const [showAtt, setShowAtt] = useState<Record<string, boolean>>({});
  const members = useFetch<{ members: { user_id: string; name: string }[] }>(`/api/buildings/${b.id}/members`);
  const rsvp = async (id: string, status: string) => { await api.put(`/api/buildings/${b.id}/meetings/${id}/rsvp`, { status }); meetings.reload(); toast.success("Aanwezigheid opgeslagen"); };
  const now = new Date();
  const list = meetings.data ?? [];
  const upcoming = list.filter((m) => new Date(m.starts_at) >= now).sort((a, c) => a.starts_at.localeCompare(c.starts_at));
  const past = list.filter((m) => new Date(m.starts_at) < now);
  const MeetingCard = ({ m }: { m: any }) => { const d = new Date(m.starts_at); return <div className="flex gap-4 rounded-xl border bg-card p-5 shadow-xs">
    <div className="hidden w-14 shrink-0 flex-col items-center rounded-lg border bg-muted/40 py-2 sm:flex"><span className="text-[11px] font-medium uppercase text-muted-foreground">{d.toLocaleString("nl-BE", { month: "short" })}</span><span className="text-2xl font-semibold leading-none">{d.getDate()}</span></div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-muted-foreground">{TYPE[m.type]}</div><h3 className="font-semibold">{m.title}</h3><div className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Calendar className="size-3.5" />{fmtDateTime(m.starts_at)}</span>{m.location && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{m.location}</span>}</div></div>
        <div className="flex gap-1"><Button size="sm" variant="outline" asChild><a href={`/api/buildings/${b.id}/meetings/${m.id}/ics`}><CalendarPlus />.ics</a></Button>{b.isBoard && <Button size="sm" variant="outline" onClick={() => setEdit(m)}><Pencil />Bewerken</Button>}</div></div>
      <MeetingAgenda meetingId={m.id} meetingStartsAt={m.starts_at} />
      {m.agenda && <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">Toelichting / vrije agenda</summary><div className="mt-2 whitespace-pre-wrap text-muted-foreground">{m.agenda}</div></details>}
      {m.minutes_document_id && <a className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline" href={`/api/buildings/${b.id}/documents/${m.minutes_document_id}/download?inline=1`} target="_blank" rel="noreferrer"><FileText className="size-4" />Verslag: {m.minutes_name}</a>}
      {new Date(m.starts_at) >= now && b.isOwner && <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm"><span className="text-muted-foreground">{t("Aanwezig?")}</span>
        {[["attending", t("Ja")], ["proxy", t("Volmacht")], ["absent", t("Nee")]].map(([s, l]) => <Button key={s} size="sm" variant={m.my_rsvp === s ? "default" : "outline"} onClick={() => s === "proxy" ? setProxyFor(m.id) : rsvp(m.id, s)}>{s === "attending" ? <Check /> : s === "absent" ? <X /> : <Users />}{l}</Button>)}
        <span className="ml-auto text-xs text-muted-foreground">{m.attending} aanwezig · {m.proxy} volmacht · {m.absent} afwezig</span><Button size="sm" variant="ghost" onClick={() => setShowAtt({ ...showAtt, [m.id]: !showAtt[m.id] })}>Quorum</Button></div>}
      {(showAtt[m.id] || new Date(m.starts_at) < now) && <AttendancePanel meeting={m} onChanged={() => meetings.reload()} />}
      {b.isBoard && <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm"><Button size="sm" variant={m.minutes_status === "final" ? "outline" : "default"} onClick={() => setMinutesFor(m)}><ScrollText />{m.minutes_status === "final" ? "Notulen (definitief)" : m.minutes_status === "draft" ? "Notulen (ontwerp)" : "Notulen opstellen"}</Button>{m.minutes_status === "final" && m.minutes_sent_at && <span className="text-xs text-muted-foreground">verzonden {fmtDateTime(m.minutes_sent_at)}</span>}</div>}
    </div>
  </div>; };
  return <div>
    <PageHeader title={t("Algemene vergadering")} subtitle={t("Het hoogste orgaan van de VME: mede-eigenaars beslissen, stemmen naar aandelen. Agenda, aanwezigheden en verslagen.")} actions={b.isBoard && <Button onClick={() => setOpen(true)}><CalendarPlus />{t("Vergadering plannen")}</Button>} />
    {!meetings.loading && <AgendaSection meetings={list} />}
    <MeetingRequests meetings={list} />
    {meetings.loading ? <Spinner /> : !list.length ? <Empty icon={<Calendar />} title="Nog geen vergaderingen gepland" /> : <>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("Komende")}</h2>{upcoming.length ? <div className="mb-8 space-y-3">{upcoming.map((m) => <MeetingCard key={m.id} m={m} />)}</div> : <p className="mb-8 text-sm text-muted-foreground">Geen geplande vergaderingen.</p>}
      {past.length > 0 && <><h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("Voorbije")}</h2><div className="space-y-3">{past.map((m) => <MeetingCard key={m.id} m={m} />)}</div></>}</>}
    {proxyFor && <ProxyDialog meetingId={proxyFor} onClose={() => setProxyFor(null)} onDone={() => { setProxyFor(null); meetings.reload(); }} />}
    {minutesFor && <MinutesDialog meeting={minutesFor} members={members.data?.members ?? []} onClose={() => setMinutesFor(null)} onDone={() => { setMinutesFor(null); meetings.reload(); }} />}
    {(open || edit) && <MeetingForm meeting={edit} onClose={() => { setOpen(false); setEdit(null); }} onDone={() => { setOpen(false); setEdit(null); meetings.reload(); }} />}
    <Dialog open={!!rsvps} onOpenChange={(o) => !o && setRsvps(null)}><DialogContent><DialogHeader><DialogTitle>Aanwezigheden: {rsvps?.m.title}</DialogTitle></DialogHeader>
      {rsvps && (rsvps.list.length ? <Table><TableBody>{rsvps.list.map((r: any, i: number) => <TableRow key={i}><TableCell className="font-medium">{r.name}</TableCell><TableCell className="text-muted-foreground">{r.email}</TableCell><TableCell>{{ attending: "Aanwezig", proxy: `Volmacht${r.proxy_name ? ` → ${r.proxy_name}` : ""}`, absent: "Afwezig" }[r.status as string]}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-muted-foreground">Nog geen antwoorden.</p>)}</DialogContent></Dialog>
  </div>;
}

function MeetingForm({ meeting, onClose, onDone }: { meeting: any; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const docs = useFetch<Doc[]>(`/api/buildings/${b.id}/documents?category=verslag_av`);
  const toLocal = (s?: string) => s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const [f, setF] = useState({ title: meeting?.title ?? "", type: meeting?.type ?? "av", starts_at: toLocal(meeting?.starts_at), location: meeting?.location ?? "", agenda: meeting?.agenda ?? "", minutes_document_id: meeting?.minutes_document_id ?? "", notify: !meeting });
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    const body = { ...f, starts_at: new Date(f.starts_at).toISOString(), minutes_document_id: f.minutes_document_id || null, location: f.location || null, agenda: f.agenda || null };
    try { if (meeting) await api.patch(`/api/buildings/${b.id}/meetings/${meeting.id}`, body); else await api.post(`/api/buildings/${b.id}/meetings`, body); onDone(); } catch (err) { setError(err); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>{meeting ? "Vergadering bewerken" : "Vergadering plannen"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field><Field label="Datum & uur"><Input type="datetime-local" required value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field></div>
      <Field label="Titel"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bv. Jaarlijkse algemene vergadering 2026" /></Field>
      <Field label="Locatie"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="bv. Inkomhal / online via Teams" /></Field>
      <Field label="Agenda"><Textarea className="min-h-36" value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} placeholder={"1. Goedkeuring verslag vorige AV\n2. Jaarrekening & kwijting syndicus\n3. Begroting\n4. Varia"} /></Field>
      <Field label="Verslag (document)" hint="Upload het verslag eerst bij Documenten (categorie “Verslagen algemene vergadering”). Leden worden verwittigd wanneer je het koppelt."><Select value={f.minutes_document_id || NONE} onValueChange={(v) => setF({ ...f, minutes_document_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>— geen —</SelectItem>{(docs.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></Field>
      {!meeting && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.notify} onCheckedChange={(v) => setF({ ...f, notify: !!v })} />Uitnodiging sturen (push + e-mail)</label>}
      <ErrorBox error={error} />
      <DialogFooter className="sm:justify-between">{meeting && b.isManager ? <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={async () => { if (confirm("Vergadering verwijderen?")) { await api.del(`/api/buildings/${b.id}/meetings/${meeting.id}`); onDone(); } }}>Verwijderen</Button> : <span />}<div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Annuleren</Button><Button>Opslaan</Button></div></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
