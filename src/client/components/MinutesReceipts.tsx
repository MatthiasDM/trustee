import { useState } from "react";
import { MailCheck, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { api, fmtDate, fmtDateTime } from "../lib/api";

/** Ontvangst van de notulen (art. 3.87 §12 BW): overzicht voor wie de vergadering beheert, melding "niet ontvangen" voor mede-eigenaars. */
export function MinutesReceipts({ meeting, canManage, onChanged }: { meeting: any; canManage: boolean; onChanged: () => void }) {
  const b = useBuilding();
  const [open, setOpen] = useState(false);
  const past = new Date(meeting.starts_at) < new Date();
  if (!past || meeting.cancelled_at || meeting.type === "raad") return null;
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
    {canManage && meeting.minutes_status === "final" && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><MailCheck />Ontvangst notulen</Button>}
    {b.isOwner && !canManage && (meeting.my_minutes_missing ? <Badge variant="secondary">niet ontvangen gemeld op {fmtDate(meeting.my_minutes_missing)}</Badge>
      : <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Melden aan de syndicus dat je de notulen niet ontving? (art. 3.87 §12 BW)")) return; await api.post(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes/not-received`); toast.success("Gemeld aan de syndicus"); onChanged(); }}><MailWarning />Notulen niet ontvangen</Button>)}
    {open && <ReceiptsDialog meetingId={meeting.id} onClose={() => setOpen(false)} />}
  </div>;
}

function ReceiptsDialog({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const b = useBuilding();
  const { data } = useFetch<any>(`/api/buildings/${b.id}/meetings/${meetingId}/minutes/receipts`);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Ontvangst van de notulen</DialogTitle><DialogDescription>Uiterlijk {data ? fmtDate(data.due) : "…"} in het register en bezorgd aan elke stemgerechtigde (art. 3.87 §12 BW).{data?.late ? " Die termijn is overschreden." : ""}</DialogDescription></DialogHeader>
    {data && <><p className="text-sm">{data.opened} van {data.total} stemgerechtigden openden de notulen.</p>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border text-sm">{data.rows.map((r: any) => <li key={r.user_id} className="flex items-center gap-2 px-3 py-1.5"><span className="flex-1">{r.name}</span>{r.reported_missing_at ? <Badge variant="red">niet ontvangen gemeld {fmtDate(r.reported_missing_at)}</Badge> : r.opened_at ? <Badge variant="success">geopend {fmtDateTime(r.opened_at)}</Badge> : r.delivered_at ? <Badge variant="outline">bezorgd, niet geopend</Badge> : <Badge variant="warning">niet bezorgd</Badge>}</li>)}</ul></>}
  </DialogContent></Dialog>;
}
