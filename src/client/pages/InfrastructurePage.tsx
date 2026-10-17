import { useState } from "react";
import { Cable, Plus } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../lib/auth";

const VARIANT: Record<string, any> = { awaiting_receipt: "outline", objection_period: "info", allowed: "success", objected: "red", own_works: "warning", withdrawn: "outline" };

/** Kabels en leidingen in de gemeenschappelijke delen (art. 3.82 §2 BW): aankondiging, verzettermijn van twee maanden, verzet, eigen werken van de VME. */
export function InfrastructurePage() {
  const b = useBuilding(); const { user } = useAuth();
  const { data, loading, reload } = useFetch<{ items: any[]; grounds: Record<string, string> }>(`/api/buildings/${b.id}/infrastructure`);
  const [form, setForm] = useState(false); const [objectFor, setObjectFor] = useState<any>(null);
  const patch = async (id: string, body: any, msg: string) => { try { await api.patch(`/api/buildings/${b.id}/infrastructure/${id}`, body); toast.success(msg); reload(); } catch (e) { toast.error((e as Error).message); } };
  return <div>
    <PageHeader title="Kabels en leidingen" subtitle="Elke mede-eigenaar en elke erkende nutsoperator mag kosteloos kabels en leidingen voor energie, water of telecommunicatie aanleggen in de gemene delen, als dat de infrastructuur van zijn kavel optimaliseert en anderen er niets voor betalen. Aankondiging minstens twee maanden vooraf per aangetekende zending aan de syndicus; verzet binnen twee maanden na ontvangst, enkel op een wettelijke grond (art. 3.82 §2 BW)."
      actions={(b.isOwner || b.isManager) && <Button onClick={() => setForm(true)}><Plus />Werken aankondigen</Button>} />
    {loading || !data ? <Spinner /> : !data.items.length ? <Empty icon={<Cable />} title="Geen aangekondigde werken" /> : <div className="space-y-3">{data.items.map((w) => <div key={w.id} className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><div className="text-xs text-muted-foreground capitalize">{w.domain} · {w.operator_name ? `nutsoperator ${w.operator_name}` : w.submitted_by_name}{w.planned_start ? ` · gepland ${fmtDate(w.planned_start)}` : ""}</div><div className="font-medium whitespace-pre-wrap">{w.description}</div></div><Badge variant={VARIANT[w.status]}>{w.status_label}</Badge>{w.progress !== "announced" && w.progress !== "withdrawn" && <Badge variant="secondary">{w.progress === "started" ? "in uitvoering" : "uitgevoerd"}</Badge>}</div>
      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">Rechtvaardiging: {w.justification}</p>
      {w.objected_at && <p className="mt-1 text-sm">Verzet door {w.objected_by_name} op {fmtDate(w.objected_at)}: {w.objection_ground_label}{w.objection_note ? ` — ${w.objection_note}` : ""}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
        <span className="text-muted-foreground">{w.received_at ? `Aangetekend ontvangen ${fmtDate(w.received_at)}` : "Ontvangst aangetekende zending nog niet geregistreerd"}</span>
        {b.isManager && !w.received_at && <Button size="sm" variant="ghost" onClick={() => patch(w.id, { received_at: new Date().toISOString().slice(0, 10) }, "Ontvangst geregistreerd")}>Ontvangen vandaag</Button>}
        {w.status === "objection_period" && w.submitted_by !== user?.id && (b.isOwner || b.isBoard) && <Button size="sm" variant="ghost" onClick={() => setObjectFor(w)}>Verzet aantekenen</Button>}
        {w.status === "objection_period" && (b.isManager || b.role === "raad") && <Button size="sm" variant="ghost" onClick={() => confirm("Beslist de VME de infrastructuur zelf te optimaliseren? De werken moeten dan binnen zes maanden beginnen.") && patch(w.id, { own_works: true }, "Geregistreerd")}>VME voert zelf uit</Button>}
        {(w.submitted_by === user?.id || b.isManager) && w.status === "allowed" && w.progress === "announced" && <Button size="sm" variant="ghost" onClick={() => patch(w.id, { progress: "started" }, "Werken gestart")}>Gestart</Button>}
        {(w.submitted_by === user?.id || b.isManager) && w.progress === "started" && <Button size="sm" variant="ghost" onClick={() => patch(w.id, { progress: "done" }, "Werken uitgevoerd")}>Uitgevoerd</Button>}
        {(w.submitted_by === user?.id) && w.progress === "announced" && <Button size="sm" variant="ghost" onClick={() => patch(w.id, { progress: "withdrawn" }, "Ingetrokken")}>Intrekken</Button>}
      </div>
    </div>)}</div>}
    {form && <AnnounceDialog onClose={() => setForm(false)} onDone={() => { setForm(false); reload(); }} />}
    {objectFor && <ObjectDialog w={objectFor} grounds={data?.grounds ?? {}} onClose={() => setObjectFor(null)} onDone={() => { setObjectFor(null); reload(); }} />}
  </div>;
}

function AnnounceDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ domain: "telecommunicatie", description: "", justification: "", sender_address: "", planned_start: "", operator_name: "", received_at: "" });
  const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Werken aan kabels of leidingen aankondigen</DialogTitle><DialogDescription>Stuur deze aankondiging ook per aangetekende zending aan de syndicus, met je adres; de termijn van twee maanden loopt vanaf de ontvangst (art. 3.82 §2 BW). Je blijft eigenaar van de infrastructuur en draagt alle kosten.</DialogDescription></DialogHeader>
    {b.isManager && <Field label="Nutsoperator (leeg als een mede-eigenaar aankondigt)"><Input value={f.operator_name} onChange={(e) => setF({ ...f, operator_name: e.target.value })} placeholder="bv. Proximus, Fluvius" /></Field>}
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Domein"><Select value={f.domain} onValueChange={(v) => setF({ ...f, domain: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="energie">Energie</SelectItem><SelectItem value="water">Water</SelectItem><SelectItem value="telecommunicatie">Telecommunicatie</SelectItem></SelectContent></Select></Field><Field label="Geplande aanvang"><Input type="date" value={f.planned_start} onChange={(e) => setF({ ...f, planned_start: e.target.value })} /></Field></div>
    <Field label="Beschrijving van de werken"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="bv. glasvezelkabel van de kelder naar appartement A3 via de technische koker" /></Field>
    <Field label="Rechtvaardiging van de optimalisatie"><Textarea value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} placeholder="bv. huidige koperaansluiting haalt geen 30 Mbps; glasvezel geeft 1 Gbps zonder kosten voor anderen" /></Field>
    <Field label="Adres van de afzender"><Input value={f.sender_address} onChange={(e) => setF({ ...f, sender_address: e.target.value })} /></Field>
    {b.isManager && f.operator_name && <Field label="Aangetekende zending ontvangen op"><Input type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></Field>}
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button onClick={async () => { setError(null); try { await api.post(`/api/buildings/${b.id}/infrastructure`, { ...f, planned_start: f.planned_start || null, operator_name: f.operator_name || null, received_at: f.received_at || null }); toast.success("Aangekondigd"); onDone(); } catch (e) { setError(e); } }}>Aankondigen</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function ObjectDialog({ w, grounds, onClose, onDone }: { w: any; grounds: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [ground, setGround] = useState(""); const [note, setNote] = useState(""); const [error, setError] = useState<unknown>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Verzet aantekenen</DialogTitle><DialogDescription>Enkel op grond van een rechtmatig belang, uiterlijk {fmtDate(w.objection_deadline)}, en ook per aangetekende zending aan de afzender (art. 3.82 §2 BW).</DialogDescription></DialogHeader>
    <Field label="Grond"><Select value={ground} onValueChange={setGround}><SelectTrigger className="w-full"><SelectValue placeholder="Kies de wettelijke grond" /></SelectTrigger><SelectContent>{Object.entries(grounds).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Toelichting"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    <ErrorBox error={error} />
    <DialogFooter><Button variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={!ground} onClick={async () => { setError(null); try { await api.patch(`/api/buildings/${b.id}/infrastructure/${w.id}`, { objection_ground: ground, objection_note: note || undefined }); toast.success("Verzet geregistreerd"); onDone(); } catch (e) { setError(e); } }}>Verzet registreren</Button></DialogFooter>
  </DialogContent></Dialog>;
}
