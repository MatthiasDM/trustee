import { useState } from "react";
import { MessageSquareQuote, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox } from "./ui";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { api, fmtDateTime } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Schriftelijke vragen van bewoners zonder stemrecht voor een algemene vergadering (art. 3.89 §5, 6° BW). */
export function ResidentQuestions({ meeting, canManage }: { meeting: any; canManage: boolean }) {
  const b = useBuilding(); const { user } = useAuth();
  const { data, reload } = useFetch<any[]>(`/api/buildings/${b.id}/meetings/${meeting.id}/questions`);
  const [body, setBody] = useState(""); const [error, setError] = useState<unknown>(null); const [open, setOpen] = useState(false);
  const future = new Date(meeting.starts_at) > new Date() && !meeting.cancelled_at;
  const tenant = b.role === "huurder";
  if (meeting.type === "raad" || (!data?.length && !tenant && !canManage)) return null;
  return <div className="mt-3 rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><MessageSquareQuote className="size-4 text-primary" /><span className="font-medium">Vragen van bewoners zonder stemrecht</span><span className="text-xs text-muted-foreground">(art. 3.89 §5, 6° BW: worden aan de vergadering meegedeeld)</span>
      {canManage && <Button size="sm" variant="ghost" className="ml-auto" onClick={async () => { const r = await api.post<{ document_id: string }>(`/api/buildings/${b.id}/meetings/${meeting.id}/resident-notice`); window.open(`/api/buildings/${b.id}/documents/${r.document_id}/download?inline=1`, "_blank"); toast.success("Mededeling gemaakt; hang ze op in de gemene delen"); }}><Printer />Mededeling bewoners</Button>}</div>
    {data?.length ? <ul className="mt-2 grid gap-1.5">{data.map((q) => <li key={q.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2 py-1.5"><div className="min-w-0 flex-1"><div className="whitespace-pre-wrap">{q.body}</div><div className="text-xs text-muted-foreground">{q.author_name} · {fmtDateTime(q.created_at)}</div></div>{q.author_id === user?.id && future && <Button size="icon-sm" variant="ghost" aria-label="Vraag intrekken" onClick={async () => { await api.del(`/api/buildings/${b.id}/meetings/${meeting.id}/questions/${q.id}`); reload(); }}><Trash2 /></Button>}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">Nog geen vragen.</p>}
    {tenant && future && (open ? <div className="mt-2 grid gap-2"><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Uw vraag of opmerking over de gemeenschappelijke delen" /><ErrorBox error={error} /><div className="flex gap-2"><Button size="sm" disabled={body.trim().length < 5} onClick={async () => { setError(null); try { await api.post(`/api/buildings/${b.id}/meetings/${meeting.id}/questions`, { body }); setBody(""); setOpen(false); reload(); toast.success("Vraag ingediend"); } catch (e) { setError(e); } }}>Indienen</Button><Button size="sm" variant="outline" onClick={() => setOpen(false)}>Annuleren</Button></div></div>
      : <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>Vraag of opmerking indienen</Button>)}
  </div>;
}
