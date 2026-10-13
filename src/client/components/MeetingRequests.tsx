import { useState, type FormEvent } from "react";
import { FileSignature, Megaphone, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Verzoek tot bijeenroeping van een AV door mede-eigenaars met minstens 1/5 van de aandelen (art. 3.87 §2). */
export function MeetingRequests() {
  const b = useBuilding(); const { user } = useAuth();
  const { data, reload } = useFetch<any[]>(`/api/buildings/${b.id}/meeting-requests`);
  const [open, setOpen] = useState(false); const [f, setF] = useState({ subject: "", body: "" }); const [error, setError] = useState<unknown>(null);
  const active = (data ?? []).filter((r) => r.status === "collecting" || r.status === "threshold_reached");
  const done = (data ?? []).filter((r) => r.status === "fulfilled" || r.status === "cancelled");
  return <div className="mb-8 rounded-xl border bg-card p-5 shadow-xs">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2 className="flex items-center gap-2 font-semibold"><FileSignature className="size-4 text-primary" />Verzoek tot algemene vergadering</h2><p className="text-sm text-muted-foreground">Mede-eigenaars die samen minstens 1/5 van de aandelen hebben, kunnen een AV eisen. De syndicus moet dan binnen 30 dagen bijeenroepen (art. 3.87 §2 BW).</p></div>{b.isOwner && !b.isManager && <Button variant="outline" onClick={() => setOpen(true)}><PenLine />Verzoek starten</Button>}</div>
    {!active.length && <p className="text-sm text-muted-foreground">Geen lopend verzoek.</p>}
    <div className="grid gap-3">{active.map((r) => { const signed = r.signatures.some((s: any) => s.user_id === user?.id); const pct = Math.min(100, (r.shares / r.needed) * 100); return <div key={r.id} className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.subject}</span>{r.status === "threshold_reached" ? <Badge variant="red"><Megaphone />1/5 bereikt · bijeenroepen vóór {fmtDate(r.deadline)}</Badge> : <Badge variant="info">handtekeningen verzamelen</Badge>}<span className="ml-auto text-xs text-muted-foreground">gestart door {r.created_by_name} op {fmtDate(r.created_at)}</span></div>
      {r.body && <p className="mt-1 text-muted-foreground">{r.body}</p>}
      <div className="mt-2 flex items-center gap-3"><Progress value={pct} className="h-2 flex-1" /><span className="text-xs tabular-nums">{r.shares} / {r.needed} aandelen ({r.total_shares} totaal)</span></div>
      <div className="mt-1 text-xs text-muted-foreground">Ondertekend door: {r.signatures.map((s: any) => `${s.name} (${s.shares})`).join(", ")}</div>
      <div className="mt-2 flex flex-wrap gap-2">{b.isOwner && !signed && <Button size="sm" onClick={async () => { const x = await api.post<any>(`/api/buildings/${b.id}/meeting-requests/${r.id}/sign`); toast.success(x.reached ? "Drempel bereikt: de syndicus moet bijeenroepen" : "Ondertekend"); reload(); }}><PenLine />Mee ondertekenen</Button>}{b.isBoard && <Button size="sm" variant="outline" onClick={async () => { await api.patch(`/api/buildings/${b.id}/meeting-requests/${r.id}`, { status: "fulfilled" }); reload(); }}>Vergadering gepland (afronden)</Button>}{(r.created_by === user?.id || b.isBoard) && <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Verzoek intrekken?")) { await api.patch(`/api/buildings/${b.id}/meeting-requests/${r.id}`, { status: "cancelled" }); reload(); } }}>Intrekken</Button>}</div>
    </div>; })}</div>
    {done.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Afgehandelde verzoeken ({done.length})</summary><ul className="mt-2 divide-y rounded-lg border">{done.map((r) => <li key={r.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1">{r.subject}</span><Badge variant={r.status === "fulfilled" ? "success" : "outline"}>{r.status === "fulfilled" ? "ingewilligd" : "ingetrokken"}</Badge></li>)}</ul></details>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Verzoek tot algemene vergadering</DialogTitle><DialogDescription>Je handtekening telt meteen mee. Andere mede-eigenaars krijgen een melding om mee te ondertekenen.</DialogDescription></DialogHeader>
      <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/meeting-requests`, f); setOpen(false); setF({ subject: "", body: "" }); reload(); } catch (err) { setError(err); } }}><Field label="Onderwerp"><Input required minLength={3} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field><Field label="Toelichting"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field><ErrorBox error={error} /><DialogFooter><Button>Verzoek starten en ondertekenen</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
