import { useState } from "react";
import { CheckCircle2, Circle, PenLine, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { api, fmtDateTime } from "../lib/api";
import { useAuth } from "../lib/auth";

const CAP: Record<string, string> = { chair: "voorzitter", secretary: "secretaris", chair_secretary: "voorzitter en secretaris", owner: "mede-eigenaar of lasthebber" };
interface SignerRow { user_id: string; name: string; capacity: string; units: string[]; remote: boolean; signed_at: string | null; method: "electronic" | "paper" | null }
export interface SignatureState { status: string; hash?: string; body?: string; signers: SignerRow[]; my_capacity?: string | null; signed_by_me?: boolean; can_sign: boolean; can_manage: boolean; missing: string[]; unsigned_reason?: string | null }

function SignerList({ rows, pick, picked }: { rows: SignerRow[]; pick?: (id: string, on: boolean) => void; picked?: Set<string> }) {
  return <ul className="divide-y rounded-lg border text-sm">{rows.map((s) => <li key={s.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
    {pick && !s.signed_at ? <Checkbox checked={picked?.has(s.user_id)} onCheckedChange={(v) => pick(s.user_id, !!v)} aria-label={`${s.name} tekende op papier`} /> : s.signed_at ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
    <span className="font-medium">{s.name}</span><span className="text-xs text-muted-foreground">{CAP[s.capacity] ?? s.capacity}{s.units.length ? ` · kavel ${s.units.join(", ")}` : ""}{s.remote ? " · vanop afstand" : ""}</span>
    <span className="ml-auto text-xs text-muted-foreground">{s.signed_at ? `${s.method === "paper" ? "op papier, geregistreerd" : "getekend"} ${fmtDateTime(s.signed_at)}` : "nog niet getekend"}</span>
  </li>)}</ul>;
}

/** Voor wie de vergadering beheert: wie tekende, papieren handtekeningen registreren, de anderen uitnodigen. Staat in het notulenvenster. */
export function SignaturesPanel({ meeting, version }: { meeting: any; version: number }) {
  const b = useBuilding();
  const { data, reload } = useFetch<SignatureState>(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes/signatures?v=${version}`);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [error, setError] = useState<unknown>(null);
  if (!data || data.status === "none" || !data.signers) return null;
  const final = data.status === "final";
  const base = `/api/buildings/${b.id}/meetings/${meeting.id}/minutes`;
  const run = async (fn: () => Promise<unknown>, ok: string) => { setError(null); try { await fn(); toast.success(ok); setPicked(new Set()); reload(); } catch (e) { setError(e); } };
  const signed = data.signers.filter((s) => s.signed_at).length;
  return <div className="rounded-lg border p-3">
    <div className="flex flex-wrap items-center gap-2 text-sm"><PenLine className="size-4 text-primary" /><span className="font-medium">Ondertekening</span><Badge variant={data.missing.length ? "warning" : "success"}>{signed} van {data.signers.length} getekend</Badge>
      {!final && <div className="ml-auto flex flex-wrap gap-1">{data.can_sign && <Button size="sm" onClick={() => run(() => api.post(`${base}/sign`, { hash: data.hash }), "Je hebt de notulen getekend")}><PenLine />Zelf tekenen</Button>}<Button size="sm" variant="outline" onClick={() => run(async () => { const r = await api.post<{ asked: number }>(`${base}/signatures/request`); if (!r.asked) throw new Error("Iedereen heeft al getekend"); }, "Uitnodiging om te tekenen verstuurd")}><Send />Vraag om te tekenen</Button></div>}</div>
    <p className="mt-1 text-xs text-muted-foreground">Na lezing tekenen de voorzitter, de secretaris en de nog aanwezige mede-eigenaars of hun lasthebbers (art. 3.87 §10 BW). {final ? "" : "Elk tekent in Trustee, of op papier: vink dan aan wie tekende. Wijzig je de tekst, dan vervallen de handtekeningen."}</p>
    {data.missing.length > 0 && !final && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Nog nodig om definitief te maken: {data.missing.join(" en ")}.</p>}
    {final && data.unsigned_reason && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Definitief gemaakt zonder handtekening van voorzitter of secretaris: {data.unsigned_reason}</p>}
    <div className="mt-2"><SignerList rows={data.signers} picked={picked} pick={final ? undefined : (id, on) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); setPicked(n); }} /></div>
    {!data.signers.length && <p className="mt-2 text-xs text-muted-foreground">Duid een voorzitter en secretaris aan en registreer de aanwezigheden: dan verschijnt hier wie tekent.</p>}
    <ErrorBox error={error} />
    {!final && picked.size > 0 && <div className="mt-2 flex justify-end"><Button size="sm" variant="outline" onClick={() => run(() => api.post(`${base}/signatures/paper`, { user_ids: [...picked] }), "Papieren handtekeningen geregistreerd")}>Tekende op papier ({picked.size})</Button></div>}
  </div>;
}

/** Voor de voorzitter, de secretaris en de aanwezige mede-eigenaars: de notulen nalezen en tekenen. */
export function SignMinutesDialog({ meeting, onClose, onDone }: { meeting: any; onClose: () => void; onDone: () => void }) {
  const b = useBuilding(); const me = useAuth().user?.id ?? "";
  const { data, error: loadError, loading, reload } = useFetch<SignatureState>(`/api/buildings/${b.id}/meetings/${meeting.id}/minutes/signatures`);
  const [error, setError] = useState<unknown>(null); const [read, setRead] = useState(false);
  const base = `/api/buildings/${b.id}/meetings/${meeting.id}/minutes`;
  const sign = async () => { setError(null); try { await api.post(`${base}/sign`, { hash: data!.hash }); toast.success("Je hebt de notulen getekend"); onDone(); } catch (e) { setError(e); reload(); } };
  const unsign = async () => { setError(null); try { await api.del(`${base}/signatures/${me}`); toast.success("Handtekening ingetrokken"); reload(); } catch (e) { setError(e); } };
  const mine = data?.signers?.find((s) => s.user_id === me);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Notulen tekenen: {meeting.title}</DialogTitle><DialogDescription>Lees de notulen na. Je tekent als {CAP[data?.my_capacity ?? "owner"]}. Trustee legt vast wie tekende, wanneer en onder welke tekst; wijzigt de tekst daarna, dan vervalt je handtekening en word je opnieuw gevraagd.</DialogDescription></DialogHeader>
    {loading ? <Spinner /> : loadError ? <ErrorBox error={loadError} /> : !data?.body ? <p className="text-sm text-muted-foreground">Er is nog geen ontwerp van de notulen.</p> : <>
      <div className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 font-mono text-xs">{data.body}</div>
      <SignerList rows={data.signers} />
      {data.can_sign && <label className="flex items-start gap-2 text-sm"><Checkbox checked={read} onCheckedChange={(v) => setRead(!!v)} className="mt-0.5" /><span>Ik heb de notulen gelezen en teken ze.</span></label>}
      {data.status === "final" && <p className="text-sm text-muted-foreground">De notulen zijn definitief.</p>}
    </>}
    <ErrorBox error={error} />
    <DialogFooter>{data?.status === "draft" && mine?.signed_at && mine.method === "electronic" && <Button variant="ghost" onClick={unsign}><Undo2 />Handtekening intrekken</Button>}<Button variant="outline" onClick={onClose}>Sluiten</Button>{data?.can_sign && <Button disabled={!read} onClick={sign}><PenLine />Tekenen</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
