import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, FileText, Gavel, Send, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { api } from "../lib/api";
import { MAJORITY_LABELS, type AgendaItem } from "../../shared/types";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/** Volmacht geven: kies een stemgerechtigde mede-eigenaar (niet de syndicus). */
export function ProxyDialog({ meetingId, onClose, onDone }: { meetingId: string; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const cands = useFetch<{ user_id: string; name: string; proxies: number }[]>(`/api/buildings/${b.id}/meetings/${meetingId}/proxy-candidates`);
  const [holder, setHolder] = useState(""); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Volmacht geven</DialogTitle><DialogDescription>Wie stemt in jouw plaats? Enkel mede-eigenaars; de syndicus mag geen volmacht dragen en niemand meer dan drie (art. 3.87 §7 BW).</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.put(`/api/buildings/${b.id}/meetings/${meetingId}/rsvp`, { status: "proxy", proxy_user_id: holder }); toast.success("Volmacht geregistreerd"); onDone(); } catch (err) { setError(err); } }}>
      <Field label="Volmachtdrager"><Select value={holder || NONE} onValueChange={(v) => setHolder(v === NONE ? "" : v)}><SelectTrigger className="w-full"><SelectValue placeholder="Kies een mede-eigenaar" /></SelectTrigger><SelectContent><SelectItem value={NONE}>— kies —</SelectItem>{(cands.data ?? []).map((c) => <SelectItem key={c.user_id} value={c.user_id}>{c.name}{c.proxies ? ` (draagt al ${c.proxies})` : ""}</SelectItem>)}</SelectContent></Select></Field>
      <ErrorBox error={error} /><DialogFooter><Button disabled={!holder}>Volmacht geven</Button></DialogFooter></form></DialogContent></Dialog>;
}

/** Aanwezigheid per kavel en quorumtoets (syndicus/raad zien namen; leden enkel de telling). */
export function AttendancePanel({ meeting, onChanged }: { meeting: any; onChanged: () => void }) {
  const b = useBuilding();
  const { data, reload } = useFetch<any>(`/api/buildings/${b.id}/meetings/${meeting.id}/attendance`);
  if (!data) return null;
  const q = data.quorum;
  return <div className="mt-4 rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><Users className="size-4 text-primary" /><span className="font-medium">Aanwezigheid en quorum</span>
      <Badge variant={q.reached ? "success" : "warning"}>{q.reached ? <CheckCircle2 /> : <XCircle />}{q.reached ? "Quorum bereikt" : "Quorum niet bereikt"}</Badge>
      <span className="text-xs text-muted-foreground">{q.present_owners}/{q.total_owners} eigenaars · {q.present_shares}/{q.total_shares} aandelen</span>
      {b.isBoard && <label className="ml-auto flex items-center gap-2 text-xs"><Switch checked={!!meeting.is_second_call} onCheckedChange={async (v) => { await api.patch(`/api/buildings/${b.id}/meetings/${meeting.id}`, { is_second_call: v, notify: false }); reload(); onChanged(); }} />Tweede bijeenroeping</label>}</div>
    <p className="mt-1 text-xs text-muted-foreground">{q.explanation}</p>
    {data.suspended_units?.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Kavel {data.suspended_units.join(", ")}: gesplitste eigendom zonder lasthebber, deelnamerecht geschorst (art. 3.87 §1, lid 2 BW).</p>}
    {data.rows.length > 0 && <table className="mt-2 w-full text-xs"><tbody>{data.rows.map((r: any) => <tr key={r.unit_id} className="border-t"><td className="py-1 font-medium">Kavel {r.label}</td><td className="py-1 text-muted-foreground">{r.shares} aand.</td><td className="py-1">{r.owner_names || <span className="text-muted-foreground">geen eigenaar</span>}</td><td className="py-1 text-right">{r.status === "attending" ? <Badge variant="success">aanwezig</Badge> : r.status === "proxy" ? <Badge variant="info">volmacht → {r.holder_name}</Badge> : r.status === "absent" ? <Badge variant="secondary">afwezig</Badge> : r.status === "suspended" ? <Badge variant="warning">geschorst (geen lasthebber)</Badge> : <Badge variant="outline">niet gemeld</Badge>}</td></tr>)}</tbody></table>}
  </div>;
}

/** Stemming per agendapunt registreren tijdens de AV: keuze per kavel, gewogen naar aandelen. */
export function VoteDialog({ meetingId, item, onClose, onDone }: { meetingId: string; item: AgendaItem; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const att = useFetch<any>(`/api/buildings/${b.id}/meetings/${meetingId}/attendance`);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [t, setT] = useState<any>(null);
  const conflict: string[] = (item as any).conflict_user_ids ?? [];
  useEffect(() => { if (att.data) { const init: Record<string, string> = {}; const prev = (item as any).vote_detail ? JSON.parse((item as any).vote_detail) : []; for (const r of att.data.rows) { const acting = r.status === "proxy" ? r.holder_id : r.voter_id; const out = r.suspended || conflict.includes(acting) || conflict.includes(r.voter_id); init[r.unit_id] = prev.find((p: any) => p.unit_id === r.unit_id)?.choice ?? (r.present && !out ? "for" : "absent"); } setChoices(init); } }, [att.data]);
  // de telling (stemplafond, belangenconflict, geschorste kavels) gebeurt op de server; de dialoog toont een proefberekening
  useEffect(() => { if (!Object.keys(choices).length) return; const h = setTimeout(() => api.post<any>(`/api/buildings/${b.id}/meetings/${meetingId}/agenda/${item.id}/vote`, { votes: Object.entries(choices).map(([unit_id, choice]) => ({ unit_id, choice })), dry_run: true }).then(setT).catch(() => {}), 200); return () => clearTimeout(h); }, [choices]);
  const rows = att.data?.rows ?? [];
  const excludedIds = new Set<string>((t?.excluded ?? []).map((x: any) => x.unit_id));
  const vf = t?.votes_for ?? 0, va = t?.votes_against ?? 0, vab = t?.votes_abstain ?? 0, pct = t?.pct ?? 0, reached = !!t?.reached, cast = vf + va;
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Stemming: {item.title}</DialogTitle><DialogDescription>{MAJORITY_LABELS[item.required_majority]}. Onthoudingen tellen niet mee voor de meerderheid; de namen van wie tegenstemt komen in de notulen. Niemand stemt voor meer dan alle anderen samen (art. 3.87 §8 BW).</DialogDescription></DialogHeader>
    {conflict.length > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Belangenconflict (art. 3.87 §9 BW): {(item as any).conflict_names?.join(", ")} nemen niet deel, persoonlijk noch bij volmacht.{(item as any).conflict_reason ? ` ${(item as any).conflict_reason}` : ""}</p>}
    <div className="max-h-80 overflow-y-auto rounded-lg border">{rows.map((r: any) => <div key={r.unit_id} className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm last:border-0"><div className="min-w-0 flex-1"><span className="font-medium">Kavel {r.label}</span> <span className="text-xs text-muted-foreground">{r.shares} aand. · {r.owner_names || "geen eigenaar"}{r.status === "proxy" ? ` · volmacht ${r.holder_name}` : ""}</span>{r.suspended && <Badge variant="warning" className="ml-1">geschorst</Badge>}{excludedIds.has(r.unit_id) && <Badge variant="warning" className="ml-1">belangenconflict</Badge>}</div>
      <div className="flex gap-1">{[["for", "Vóór"], ["against", "Tegen"], ["abstain", "Onthouding"], ["absent", "Afwezig"]].map(([v, l]) => <button key={v} type="button" disabled={!r.owner_ids?.length || r.suspended || excludedIds.has(r.unit_id)} className={cn("rounded-md border px-2 py-1 text-xs cursor-pointer disabled:opacity-40", choices[r.unit_id] === v ? (v === "for" ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40" : v === "against" ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-950/40" : "border-primary bg-primary/10") : "hover:bg-accent")} onClick={() => setChoices({ ...choices, [r.unit_id]: v })}>{l}</button>)}</div></div>)}</div>
    {t && <div className={cn("grid gap-1 rounded-lg border p-3 text-sm", reached ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20")}>
      <div className="flex flex-wrap items-center gap-3"><span>Vóór <strong>{vf}</strong></span><span>Tegen <strong>{va}</strong></span><span>Onthouding <strong>{vab}</strong></span>{cast > 0 && item.required_majority !== "unanimous" && <span>{(pct * 100).toFixed(1)} % vóór</span>}<span className="ml-auto flex items-center gap-1 font-medium">{reached ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-amber-600" />}{reached ? "Aangenomen" : "Niet aangenomen"}</span></div>
      {t.capped?.length > 0 && <div className="text-xs">Stemplafond: {t.capped.map((x: any) => `${x.name} telt voor ${x.counted} i.p.v. ${x.had} aandelen`).join("; ")}.</div>}
      {t.excluded?.length > 0 && <div className="text-xs">Uitgesloten wegens belangenconflict: kavel {t.excluded.map((x: any) => `${x.label} (${x.name})`).join(", ")}.</div>}
      {t.invalid?.length > 0 && <div className="text-xs text-destructive">Kavel {t.invalid.map((x: any) => x.label).join(", ")}: geschorst, kies "Afwezig".</div>}
    </div>}
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button onClick={async () => { setError(null); try { const r = await api.post<any>(`/api/buildings/${b.id}/meetings/${meetingId}/agenda/${item.id}/vote`, { votes: Object.entries(choices).map(([unit_id, choice]) => ({ unit_id, choice })) }); toast.success(r.decision); onDone(); } catch (err) { setError(err); } }}><Gavel />Beslissing vastleggen</Button></DialogFooter>
  </DialogContent></Dialog>;
}

/** Notulen: ontwerp genereren, bewerken, definitief maken en verzenden. */
export function MinutesDialog({ meeting, members, onClose, onDone }: { meeting: any; members: { user_id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [body, setBody] = useState<string>(meeting.minutes_body ?? ""); const [chair, setChair] = useState(meeting.chair_user_id ?? ""); const [sec, setSec] = useState(meeting.secretary_user_id ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const final = meeting.minutes_status === "final";
  const generate = async () => { setBusy(true); setError(null); try { await api.patch(`/api/buildings/${b.id}/meetings/${meeting.id}`, { chair_user_id: chair || null, secretary_user_id: sec || null, notify: false }); const r = await api.post<{ body: string }>(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes/generate`); setBody(r.body); } catch (err) { setError(err); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); setError(null); try { await api.patch(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes`, { body }); toast.success("Ontwerp bewaard"); onDone(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const finalize = async () => { if (!confirm("Notulen definitief maken en verzenden aan alle stemgerechtigde mede-eigenaars? Daarna zijn ze niet meer te wijzigen.")) return; setBusy(true); setError(null); try { await api.patch(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes`, { body }); await api.post(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes/finalize`); toast.success("Notulen verzonden en bewaard in Documenten"); onDone(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const PersonSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={final}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>—</SelectItem>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select>;
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Notulen: {meeting.title}</DialogTitle><DialogDescription>{final ? "Definitief en verzonden." : "Genereer een ontwerp uit aanwezigheid, quorum en beslissingen, vul aan en maak definitief. Verzending binnen 30 dagen na de vergadering (art. 3.87 §12 BW)."}</DialogDescription></DialogHeader>
    {!final && <div className="grid gap-3 sm:grid-cols-3"><Field label="Voorzitter"><PersonSelect value={chair} onChange={setChair} /></Field><Field label="Secretaris"><PersonSelect value={sec} onChange={setSec} /></Field><div className="flex items-end"><Button type="button" variant="outline" className="w-full" disabled={busy} onClick={generate}><FileText />{body ? "Opnieuw genereren" : "Ontwerp genereren"}</Button></div></div>}
    <Textarea className="min-h-[50vh] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} readOnly={final} placeholder="Klik op 'Ontwerp genereren' of schrijf de notulen hier." />
    <ErrorBox error={error} />
    <DialogFooter>{final ? <Button variant="outline" asChild><a href={`/api/buildings/${b.id}/documents/${meeting.minutes_document_id}/download?inline=1`} target="_blank" rel="noreferrer"><FileText />Document openen</a></Button> : <><Button variant="outline" disabled={busy || !body} onClick={save}>Ontwerp bewaren</Button>{b.isManager && <Button disabled={busy || !body} onClick={finalize}><Send />Definitief maken en verzenden</Button>}</>}</DialogFooter></DialogContent></Dialog>;
}
