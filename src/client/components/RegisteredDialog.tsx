import { useState } from "react";
import { FileDown, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, Field, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { api, fmtDate } from "../lib/api";

/**
 * Aangetekende zendingen bij een vergadering: wie aangetekend bereikt moet worden (geen akkoord voor elektronische oproeping, of e-mail onbezorgbaar),
 * de brieven als PDF, en het register van de verzendingen (datum van afgifte en barcode van het afgiftebewijs).
 */
export function RegisteredDialog({ meetingId, kind, onClose }: { meetingId: string; kind: "convocation" | "minutes"; onClose: () => void }) {
  const b = useBuilding();
  const base = `/api/buildings/${b.id}/meetings/${meetingId}/registered`;
  const { data, loading, reload } = useFetch<any>(`${base}?kind=${kind}`);
  const [picked, setPicked] = useState<Record<string, boolean>>({}); const [tracking, setTracking] = useState<Record<string, string>>({});
  const [sentAt, setSentAt] = useState(new Date().toISOString().slice(0, 10)); const [method, setMethod] = useState("post");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const ids = Object.keys(picked).filter((k) => picked[k]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<any>(base, { kind, user_ids: ids, sent_at: sentAt, method, tracking: Object.fromEntries(ids.filter((i) => tracking[i]).map((i) => [i, tracking[i]])) });
      toast.success(`${r.recorded} verzending(en) geregistreerd`); if (r.warning) toast.warning(r.warning);
      setPicked({}); setTracking({}); reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Aangetekend versturen: {kind === "minutes" ? "notulen" : "oproeping"}</DialogTitle><DialogDescription>Trustee maakt de brieven aan en houdt bij wat verstuurd is. De afgifte bij de post, of bij een aanbieder van elektronisch aangetekende zendingen, doe je zelf; noteer daarna de datum en de barcode van het afgiftebewijs.</DialogDescription></DialogHeader>
    {loading || !data ? <Spinner /> : !data.needed.length ? <p className="text-sm text-muted-foreground">Niemand moet aangetekend bereikt worden: elke stemgerechtigde stemde in met elektronische oproeping en heeft een werkend e-mailadres.</p> : <>
      <div className="max-h-72 overflow-y-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="w-8 px-3 py-1.5" /><th className="px-3 py-1.5 font-medium">Geadresseerde</th><th className="px-3 py-1.5 font-medium">Status</th><th className="px-3 py-1.5 font-medium">Barcode</th></tr></thead>
        <tbody>{data.needed.map((n: any) => { const last = n.sent[n.sent.length - 1]; return <tr key={n.user_id} className="border-t align-top">
          <td className="px-3 py-2"><Checkbox aria-label={`${n.name} selecteren`} checked={!!picked[n.user_id]} onCheckedChange={(v) => setPicked({ ...picked, [n.user_id]: !!v })} /></td>
          <td className="px-3 py-2"><div className="font-medium">{n.name}{n.units ? <span className="font-normal text-muted-foreground"> · kavel {n.units}</span> : null}</div><div className={`text-xs ${n.postal_address ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}>{n.postal_address ?? "Postadres ontbreekt: vul het in onder Leden"}</div><div className="mt-0.5 text-xs text-muted-foreground">{n.reason === "bounce" ? "e-mailadres onbezorgbaar" : "geen akkoord voor elektronische oproeping"}</div></td>
          <td className="px-3 py-2">{last ? <Badge variant="success"><MailCheck />{fmtDate(last.sent_at)}{last.tracking_number ? ` · ${last.tracking_number}` : ""}</Badge> : <Badge variant="warning">nog te versturen</Badge>}</td>
          <td className="px-3 py-2">{picked[n.user_id] && <Input className="h-8" placeholder="bv. 010541…" value={tracking[n.user_id] ?? ""} onChange={(e) => setTracking({ ...tracking, [n.user_id]: e.target.value })} />}</td>
        </tr>; })}</tbody></table></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Datum van afgifte"><Input type="date" value={sentAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSentAt(e.target.value)} /></Field>
        <Field label="Wijze"><Select value={method} onValueChange={setMethod}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="post">Aangetekende brief (post)</SelectItem><SelectItem value="electronic">Elektronisch aangetekende zending</SelectItem></SelectContent></Select></Field></div>
      <ErrorBox error={error} />
      <DialogFooter className="sm:justify-between"><Button variant="outline" asChild><a href={`${base}/letters.pdf?kind=${kind}${data.open ? "" : "&all=1"}`} download><FileDown />Brieven (PDF){data.open ? ` · ${data.open}` : ""}</a></Button>
        <Button disabled={busy || !ids.length || !sentAt} onClick={save}>Verzending registreren{ids.length ? ` (${ids.length})` : ""}</Button></DialogFooter>
    </>}
  </DialogContent></Dialog>;
}
