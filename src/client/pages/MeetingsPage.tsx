import { useState, type FormEvent } from "react";
import { Calendar, CalendarPlus, Check, FileText, MapPin, Pencil, ScrollText, Send, Users, X, Gavel } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useBuilding, useFetch } from "../components/Layout";
import { AgendaSection, MeetingAgenda } from "../components/AgendaSection";
import { AttendancePanel, MinutesDialog, ProxyDialog } from "../components/MeetingTools";
import { MeetingRequests } from "../components/MeetingRequests";
import { CancelMeetingDialog, ConveneDialog } from "../components/ConveneDialog";
import { ResidentQuestions } from "../components/ResidentQuestions";
import { Badge } from "../components/ui/badge";
import { Empty, ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
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
  const [open, setOpen] = useState<boolean | { title: string; type: string; basis?: string | null }>(false); const [edit, setEdit] = useState<any>(null); const [rsvps, setRsvps] = useState<any>(null);
  const [conveneFor, setConveneFor] = useState<string | null>(null); const [cancelFor, setCancelFor] = useState<any>(null);
  const [proxyFor, setProxyFor] = useState<string | null>(null); const [minutesFor, setMinutesFor] = useState<any>(null); const [showAtt, setShowAtt] = useState<Record<string, boolean>>({});
  const members = useFetch<{ members: { user_id: string; name: string }[] }>(`/api/buildings/${b.id}/members`);
  const rsvp = async (id: string, status: string) => { await api.put(`/api/buildings/${b.id}/meetings/${id}/rsvp`, { status }); meetings.reload(); toast.success("Aanwezigheid opgeslagen"); };
  const now = new Date();
  const list = meetings.data ?? [];
  const upcoming = list.filter((m) => new Date(m.starts_at) >= now && !m.cancelled_at).sort((a, c) => a.starts_at.localeCompare(c.starts_at));
  const past = list.filter((m) => new Date(m.starts_at) < now && !m.cancelled_at);
  const cancelled = list.filter((m) => m.cancelled_at);
  const MeetingCard = ({ m }: { m: any }) => { const d = new Date(m.starts_at); return <div className="flex gap-4 rounded-xl border bg-card p-5 shadow-xs">
    <div className="hidden w-14 shrink-0 flex-col items-center rounded-lg border bg-muted/40 py-2 sm:flex"><span className="text-[11px] font-medium uppercase text-muted-foreground">{d.toLocaleString("nl-BE", { month: "short" })}</span><span className="text-2xl font-semibold leading-none">{d.getDate()}</span></div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs text-muted-foreground">{TYPE[m.type]}</div><h3 className="font-semibold">{m.title}</h3><div className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Calendar className="size-3.5" />{fmtDateTime(m.starts_at)}</span>{m.location && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{m.location}</span>}</div></div>
        <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" asChild><a href={`/api/buildings/${b.id}/meetings/${m.id}/ics`}><CalendarPlus />.ics</a></Button>{(b.isBoard || m.can_manage) && <Button size="sm" variant="outline" onClick={() => setEdit(m)}><Pencil />Bewerken</Button>}{(b.isBoard || m.can_manage) && d >= now && !m.cancelled_at && <Button size="sm" variant={m.convened_at ? "outline" : "default"} onClick={() => setConveneFor(m.id)}><Send />{m.convened_at ? "Opnieuw oproepen" : "Oproepen"}</Button>}</div></div>
      {m.cancelled_at ? <p className="mt-2 text-sm text-destructive">Geannuleerd op {fmtDateTime(m.cancelled_at)}{m.cancelled_by_name ? ` door ${m.cancelled_by_name}` : ""}: {m.cancel_reason}</p>
        : d >= now && <p className="mt-2 text-xs text-muted-foreground">{m.convened_at ? <><Badge variant="success">Opgeroepen</Badge> op {fmtDateTime(m.convened_at)}{m.convened_by_name ? ` door ${m.convened_by_name}` : ""}</> : (b.isBoard || m.can_manage) ? <><Badge variant="warning">Nog niet opgeroepen</Badge> De leden zijn nog niet verwittigd; verstuur de oproeping minstens 15 dagen vooraf.</> : <Badge variant="outline">Oproeping volgt</Badge>}</p>}
      {!!m.convened_by_owners && <p className="mt-2 text-xs text-muted-foreground"><Badge variant="info">Bijeengeroepen door mede-eigenaars</Badge> {m.created_by_name ? `door ${m.created_by_name}. ` : ""}{m.legal_basis}</p>}
      <MeetingAgenda meetingId={m.id} meetingStartsAt={m.starts_at} canManage={!!m.can_manage} />
      <ResidentQuestions meeting={m} canManage={b.isBoard || !!m.can_manage} />
      {m.agenda && <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">Toelichting / vrije agenda</summary><div className="mt-2 whitespace-pre-wrap text-muted-foreground">{m.agenda}</div></details>}
      {m.minutes_document_id && <a className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline" href={`/api/buildings/${b.id}/documents/${m.minutes_document_id}/download?inline=1`} target="_blank" rel="noreferrer"><FileText className="size-4" />Verslag: {m.minutes_name}</a>}
      {new Date(m.starts_at) >= now && b.isOwner && <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm"><span className="text-muted-foreground">{t("Aanwezig?")}</span>
        {[["attending", t("Ja")], ["proxy", t("Volmacht")], ["absent", t("Nee")]].map(([s, l]) => <Button key={s} size="sm" variant={m.my_rsvp === s ? "default" : "outline"} onClick={() => s === "proxy" ? setProxyFor(m.id) : rsvp(m.id, s)}>{s === "attending" ? <Check /> : s === "absent" ? <X /> : <Users />}{l}</Button>)}
        <span className="ml-auto text-xs text-muted-foreground">{m.attending} aanwezig · {m.proxy} volmacht · {m.absent} afwezig</span><Button size="sm" variant="ghost" onClick={() => setShowAtt({ ...showAtt, [m.id]: !showAtt[m.id] })}>Quorum</Button></div>}
      {(showAtt[m.id] || new Date(m.starts_at) < now) && <AttendancePanel meeting={m} onChanged={() => meetings.reload()} />}
      {(b.isBoard || m.can_manage) && <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm"><Button size="sm" variant={m.minutes_status === "final" ? "outline" : "default"} onClick={() => setMinutesFor(m)}><ScrollText />{m.minutes_status === "final" ? "Notulen (definitief)" : m.minutes_status === "draft" ? "Notulen (ontwerp)" : "Notulen opstellen"}</Button>{m.minutes_status === "final" && m.minutes_sent_at && <span className="text-xs text-muted-foreground">verzonden {fmtDateTime(m.minutes_sent_at)}</span>}</div>}
    </div>
  </div>; };
  return <div>
    <PageHeader title={t("Algemene vergadering")} subtitle={t("Het hoogste orgaan van de VME: mede-eigenaars beslissen, stemmen naar aandelen. Agenda, aanwezigheden en verslagen.")} actions={<><Button variant="outline" asChild><Link to={`/b/${b.id}/decisions`}><Gavel />Beslissingenregister</Link></Button>{b.isBoard && <Button onClick={() => setOpen(true)}><CalendarPlus />{t("Vergadering plannen")}</Button>}</>} />
    {!meetings.loading && <AgendaSection meetings={list} />}
    <MeetingRequests meetings={list} onConvene={(r) => setOpen({ title: r.subject, type: "av", basis: r.convene_basis })} />
    {meetings.loading ? <Spinner /> : !list.length ? <Empty icon={<Calendar />} title="Nog geen vergaderingen gepland" /> : <>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("Komende")}</h2>{upcoming.length ? <div className="mb-8 space-y-3">{upcoming.map((m) => <MeetingCard key={m.id} m={m} />)}</div> : <p className="mb-8 text-sm text-muted-foreground">Geen geplande vergaderingen.</p>}
      {past.length > 0 && <><h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("Voorbije")}</h2><div className="space-y-3">{past.map((m) => <MeetingCard key={m.id} m={m} />)}</div></>}</>}
    {cancelled.length > 0 && <details className="mt-8 text-sm"><summary className="cursor-pointer text-muted-foreground">Geannuleerde vergaderingen ({cancelled.length})</summary><div className="mt-3 space-y-3">{cancelled.map((m) => <MeetingCard key={m.id} m={m} />)}</div></details>}
    {conveneFor && <ConveneDialog meetingId={conveneFor} onClose={() => setConveneFor(null)} onDone={() => { setConveneFor(null); meetings.reload(); }} />}
    {cancelFor && <CancelMeetingDialog meeting={cancelFor} onClose={() => setCancelFor(null)} onDone={() => { setCancelFor(null); setEdit(null); meetings.reload(); }} />}
    {proxyFor && <ProxyDialog meetingId={proxyFor} onClose={() => setProxyFor(null)} onDone={() => { setProxyFor(null); meetings.reload(); }} />}
    {minutesFor && <MinutesDialog meeting={minutesFor} members={members.data?.members ?? []} onClose={() => setMinutesFor(null)} onDone={() => { setMinutesFor(null); meetings.reload(); }} />}
    {(open || edit) && <MeetingForm meeting={edit} preset={typeof open === "object" ? open : undefined} onClose={() => { setOpen(false); setEdit(null); }} onDone={() => { setOpen(false); setEdit(null); meetings.reload(); }} onCancel={(m) => setCancelFor(m)} />}
    <Dialog open={!!rsvps} onOpenChange={(o) => !o && setRsvps(null)}><DialogContent><DialogHeader><DialogTitle>Aanwezigheden: {rsvps?.m.title}</DialogTitle></DialogHeader>
      {rsvps && (rsvps.list.length ? <Table><TableBody>{rsvps.list.map((r: any, i: number) => <TableRow key={i}><TableCell className="font-medium">{r.name}</TableCell><TableCell className="text-muted-foreground">{r.email}</TableCell><TableCell>{{ attending: "Aanwezig", proxy: `Volmacht${r.proxy_name ? ` → ${r.proxy_name}` : ""}`, absent: "Afwezig" }[r.status as string]}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-muted-foreground">Nog geen antwoorden.</p>)}</DialogContent></Dialog>
  </div>;
}

function MeetingForm({ meeting, preset, onClose, onDone, onCancel }: { meeting: any; preset?: { title: string; type: string; basis?: string | null }; onClose: () => void; onDone: () => void; onCancel?: (m: any) => void }) {
  const b = useBuilding();
  const docs = useFetch<Doc[]>(`/api/buildings/${b.id}/documents?category=verslag_av`);
  const toLocal = (s?: string) => s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const [f, setF] = useState({ title: meeting?.title ?? preset?.title ?? "", type: meeting?.type ?? preset?.type ?? "av", starts_at: toLocal(meeting?.starts_at), location: meeting?.location ?? "", agenda: meeting?.agenda ?? "", minutes_document_id: meeting?.minutes_document_id ?? "" });
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
      {preset?.basis && <p className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Je roept deze vergadering zelf bijeen als mede-eigenaar. Grond: {preset.basis}. Je beheert ze daarna zelf: agenda, oproeping, aanwezigheden, stemmingen en notulen.</p>}
      {!meeting && <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Plannen verstuurt nog niets. Agendeer eerst de punten en verstuur daarna de oproeping met de knop <strong>Oproepen</strong>; je ziet dan wie elektronisch en wie aangetekend moet worden verwittigd.</p>}
      {meeting?.convened_at && <p className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Deze vergadering is al opgeroepen. Wijzig je datum of plaats, dan krijgen alle leden automatisch bericht en moet je een nieuwe oproeping versturen (termijn van 15 dagen opnieuw).</p>}
      <ErrorBox error={error} />
      <DialogFooter className="sm:justify-between">{meeting && (b.isManager || meeting.can_manage) ? (meeting.convened_at ? <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onCancel?.(meeting)}>Annuleren (met bericht)</Button> : <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={async () => { if (confirm("Vergadering verwijderen? Ze is nog niet opgeroepen, dus niemand wordt verwittigd.")) { try { await api.del(`/api/buildings/${b.id}/meetings/${meeting.id}`); onDone(); } catch (e) { toast.error((e as Error).message); } } }}>Verwijderen</Button>) : <span />}<div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Annuleren</Button><Button>Opslaan</Button></div></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
