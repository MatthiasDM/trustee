import { useState } from "react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DocumentPicker } from "../ledger/DocumentPicker";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../lib/auth";

const GROUNDS: Record<string, string> = { end_of_indivision: "De onverdeeldheid houdt op te bestaan", av_unanimous: "Eenparige beslissing van alle mede-eigenaars (authentieke akte)", court: "Vonnis op verzoek van een belanghebbende" };
const NONE = "__none__";

/** Ontbinding en vereffening van de VME (art. 3.97 en 3.98 BW). */
export function DissolutionCard() {
  const b = useBuilding(); const { refresh } = useAuth();
  const { data, reload } = useFetch<any>(`/api/buildings/${b.id}/dissolution`);
  const members = useFetch<{ members: { user_id: string; name: string }[] }>(`/api/buildings/${b.id}/members`);
  const decisions = useFetch<{ items: any[] }>(`/api/buildings/${b.id}/decisions`);
  const [f, setF] = useState({ ground: "av_unanimous", dissolved_at: new Date().toISOString().slice(0, 10), item_id: "", document_id: "", liquidator_user_id: "", liquidator_name: "" });
  const [cl, setCl] = useState({ archive_place: "", consignment_note: "", closing_act_document_id: "", closed_at: new Date().toISOString().slice(0, 10), transcribed_at: "" });
  const [open, setOpen] = useState(false); const [error, setError] = useState<unknown>(null);
  if (!data || !b.isManager) return null;
  const done = async () => { await refresh(); reload(); };
  return <Card><CardHeader><CardTitle>Ontbinding en vereffening</CardTitle><CardDescription>De VME is ontbonden zodra de onverdeeldheid ophoudt, door een eenparige beslissing van alle mede-eigenaars bij authentieke akte, of door de rechter. Ze bestaat dan voort voor haar vereffening (art. 3.97 en 3.98 BW).</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm">
    {!data.dissolution_status && (!open ? <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>Ontbinding registreren</Button> : <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Grond"><Select value={f.ground} onValueChange={(v) => setF({ ...f, ground: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(GROUNDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></Field><Field label="Datum van ontbinding"><Input type="date" value={f.dissolved_at} onChange={(e) => setF({ ...f, dissolved_at: e.target.value })} /></Field></div>
      {f.ground === "av_unanimous" && <Field label="Eenparige beslissing"><Select value={f.item_id || NONE} onValueChange={(v) => setF({ ...f, item_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>kies…</SelectItem>{(decisions.data?.items ?? []).filter((d) => d.adopted === 1 && d.required_majority === "unanimous").map((d) => <SelectItem key={d.id} value={d.id}>{d.title} ({d.decided_on})</SelectItem>)}</SelectContent></Select></Field>}
      {f.ground !== "end_of_indivision" && <Field label={f.ground === "court" ? "Vonnis" : "Authentieke akte"}><DocumentPicker value={f.document_id} onChange={(id) => setF({ ...f, document_id: id })} suggestedName={f.ground === "court" ? "Vonnis ontbinding VME" : "Akte ontbinding VME"} /></Field>}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Vereffenaar (lid)" hint="Leeg: de syndicus is belast met de vereffening (art. 3.98 §2)."><Select value={f.liquidator_user_id || NONE} onValueChange={(v) => setF({ ...f, liquidator_user_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>de syndicus</SelectItem>{(members.data?.members ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select></Field><Field label="of naam (extern)"><Input value={f.liquidator_name} onChange={(e) => setF({ ...f, liquidator_name: e.target.value })} /></Field></div>
      <ErrorBox error={error} />
      <div className="flex gap-2"><Button variant="destructive" onClick={async () => { setError(null); try { await api.post(`/api/buildings/${b.id}/dissolution`, { ...f, item_id: f.item_id || null, document_id: f.document_id || null, liquidator_user_id: f.liquidator_user_id || null, liquidator_name: f.liquidator_name || null }); toast.success("Ontbinding geregistreerd: de VME is in vereffening"); setOpen(false); done(); } catch (e) { setError(e); } }}>Ontbinding vastleggen</Button><Button variant="outline" onClick={() => setOpen(false)}>Annuleren</Button></div>
    </div>)}
    {data.dissolution_status && <div className="grid gap-1"><div>Ontbonden op <strong>{fmtDate(data.dissolved_at)}</strong>: {GROUNDS[data.dissolution_ground]}.</div><div>Vereffenaar: {data.liquidator_label}.</div>{data.dissolution_status === "closed" && <><div>Vereffening afgesloten op <strong>{fmtDate(data.closed_at)}</strong>. Boeken en bescheiden: {data.archive_place}.</div>{data.prescription_until && <div>Rechtsvorderingen verjaren op {fmtDate(data.prescription_until)} (5 jaar na de overschrijving, art. 3.98 §5).</div>}</>}</div>}
    {data.dissolution_status === "in_liquidation" && <div className="grid gap-3 rounded-lg border p-3"><div className="font-medium">Vereffening afsluiten (art. 3.98 §4)</div>
      <Field label="Notariële slotakte"><DocumentPicker value={cl.closing_act_document_id} onChange={(id) => setCl({ ...cl, closing_act_document_id: id })} suggestedName="Slotakte vereffening" /></Field>
      <Field label="Plaats waar boeken en bescheiden minstens 5 jaar bewaard worden"><Input value={cl.archive_place} onChange={(e) => setCl({ ...cl, archive_place: e.target.value })} /></Field>
      <Field label="Consignatie van niet-uitgekeerde gelden en waarden"><Textarea value={cl.consignment_note} onChange={(e) => setCl({ ...cl, consignment_note: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Datum slotakte"><Input type="date" value={cl.closed_at} onChange={(e) => setCl({ ...cl, closed_at: e.target.value })} /></Field><Field label="Datum overschrijving"><Input type="date" value={cl.transcribed_at} onChange={(e) => setCl({ ...cl, transcribed_at: e.target.value })} /></Field></div>
      <p className="text-xs text-muted-foreground">Download eerst het volledige archief onder <em>Archief, back-ups en systeemstatus</em>. Na het afsluiten is het platform voor deze VME enkel nog leesbaar.</p>
      <ErrorBox error={error} />
      <Button variant="destructive" className="w-fit" onClick={async () => { if (!confirm("Vereffening afsluiten? Daarna is enkel inzage en export nog mogelijk.")) return; setError(null); try { await api.patch(`/api/buildings/${b.id}/dissolution`, { close: true, ...cl, transcribed_at: cl.transcribed_at || undefined, consignment_note: cl.consignment_note || undefined }); toast.success("Vereffening afgesloten"); done(); } catch (e) { setError(e); } }}>Vereffening afsluiten</Button>
    </div>}
  </CardContent></Card>;
}
