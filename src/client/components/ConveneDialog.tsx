import { useState } from "react";
import { AlertTriangle, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, RoleBadge, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { api, fmtDate, fmtDateTime } from "../lib/api";

/**
 * Oproeping versturen: voorbeeld met ontvangers, akkoord voor elektronische oproeping (anders aangetekend),
 * termijncontrole (15 dagen) en agendacontrole. Waarschuwingen moeten uitdrukkelijk bevestigd worden; alles wordt gelogd.
 */
export function ConveneDialog({ meetingId, onClose, onDone }: { meetingId: string; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const { data, loading } = useFetch<any>(`/api/buildings/${b.id}/meetings/${meetingId}/convene`);
  const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const send = async () => { setBusy(true); setError(null); try { const r = await api.post<any>(`/api/buildings/${b.id}/meetings/${meetingId}/convene`, { acknowledge: ack }); toast.success(`Oproeping verstuurd aan ${r.recipients} leden${r.registered_needed ? `; ${r.registered_needed} nog aangetekend` : ""}`); onDone(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Oproeping versturen</DialogTitle><DialogDescription>De oproeping gaat als melding, e-mail en push naar de leden hieronder, met de agenda. De syndicus blijft verantwoordelijk voor termijn, inhoud en verzendwijze (art. 3.87 §3 BW); deze handeling wordt gelogd.</DialogDescription></DialogHeader>
    {loading || !data ? <Spinner /> : <>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-lg border p-3"><div className="text-lg font-semibold tabular-nums">{data.days_until}</div><div className="text-xs text-muted-foreground">dagen tot de vergadering (min. {data.min_days})</div></div>
        <div className="rounded-lg border p-3"><div className="text-lg font-semibold tabular-nums">{data.agenda_items}</div><div className="text-xs text-muted-foreground">geagendeerde punten</div></div>
        <div className="rounded-lg border p-3"><div className="text-lg font-semibold tabular-nums">{data.registered_needed.length}</div><div className="text-xs text-muted-foreground">aangetekend te versturen</div></div>
      </div>
      {data.warnings.length > 0 && <ul className="grid gap-1.5">{data.warnings.map((w: string, i: number) => <li key={i} className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</li>)}</ul>}
      <div className="max-h-64 overflow-y-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 font-medium">Lid</th><th className="px-3 py-1.5 font-medium">Kavel</th><th className="px-3 py-1.5 font-medium">Verzending</th></tr></thead>
        <tbody>{data.recipients.map((r: any) => <tr key={r.user_id} className="border-t"><td className="px-3 py-1.5"><div className="flex items-center gap-2">{r.name}<RoleBadge role={r.role} /></div></td><td className="px-3 py-1.5 text-muted-foreground">{r.units ?? "–"}</td><td className="px-3 py-1.5">{r.role === "huurder" ? <span className="text-xs text-muted-foreground">ter info</span> : r.ecomm_consent_at ? <Badge variant="success"><Mail />elektronisch (akkoord {fmtDate(r.ecomm_consent_at)})</Badge> : <Badge variant="warning">aangetekend</Badge>}</td></tr>)}</tbody></table></div>
      {data.meeting.convened_at && <p className="text-xs text-muted-foreground">Eerder opgeroepen op {fmtDateTime(data.meeting.convened_at)}.</p>}
      {data.warnings.length > 0 && <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" /><span>Ik heb de waarschuwingen gelezen en neem de verantwoordelijkheid voor deze oproeping (en voor de aangetekende verzending waar nodig).</span></label>}
      <ErrorBox error={error} />
      <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={busy || (data.warnings.length > 0 && !ack)} onClick={send}><Send />{data.meeting.convened_at ? "Opnieuw versturen" : "Oproeping versturen"}</Button></DialogFooter>
    </>}
  </DialogContent></Dialog>;
}

/** Vergadering annuleren met reden: leden krijgen bericht, agendapunten gaan terug naar voorstellen. */
export function CancelMeetingDialog({ meeting, onClose, onDone }: { meeting: any; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Vergadering annuleren</DialogTitle><DialogDescription>"{meeting.title}" van {fmtDateTime(meeting.starts_at)}. Alle leden krijgen een bericht met de reden; de vergadering blijft zichtbaar als geannuleerd, de geagendeerde punten gaan terug naar de voorstellen.</DialogDescription></DialogHeader>
    <textarea className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm" placeholder="Reden (verplicht), bv. per vergissing ingepland; nieuwe datum volgt" value={reason} onChange={(e) => setReason(e.target.value)} />
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Terug</Button><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); setError(null); try { await api.post(`/api/buildings/${b.id}/meetings/${meeting.id}/cancel`, { reason }); toast.success("Vergadering geannuleerd, leden verwittigd"); onDone(); } catch (e) { setError(e); } finally { setBusy(false); } }}>Annuleren en verwittigen</Button></DialogFooter>
  </DialogContent></Dialog>;
}
