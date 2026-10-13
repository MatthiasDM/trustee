import { useState, type FormEvent } from "react";
import { CheckCircle2, MessageSquareText, AlertOctagon, Trash2 } from "lucide-react";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox, RoleBadge, UserAvatar } from "./ui";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api, timeAgo } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Doc, DocComment } from "../../shared/types";

const KIND: Record<string, { label: string; variant: any; icon: any }> = { remark: { label: "Opmerking", variant: "secondary", icon: MessageSquareText }, finding: { label: "Bevinding", variant: "red", icon: AlertOctagon }, approved: { label: "Nagezien, in orde", variant: "success", icon: CheckCircle2 } };

/** Controle-opmerkingen van commissaris / raad op een document. Controle, geen bewerking (art. 3.90–3.91 BW). */
export function DocCommentsDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const b = useBuilding();
  const { user } = useAuth();
  const { data, reload } = useFetch<DocComment[]>(`/api/buildings/${b.id}/documents/${doc.id}/comments`);
  const [body, setBody] = useState(""); const [kind, setKind] = useState("remark"); const [error, setError] = useState<unknown>(null);
  const canComment = b.isBoard;
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>Controle: {doc.name}</DialogTitle><DialogDescription>{b.role === "commissaris" ? "Als commissaris van de rekeningen controleer je en rapporteer je; wijzigen van de stukken doet de syndicus." : "Opmerkingen en bevindingen van raad, commissaris en syndicus."}</DialogDescription></DialogHeader>
    <div className="grid gap-3">{(data ?? []).map((c) => { const K = KIND[c.kind]; return <div key={c.id} className="rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2"><UserAvatar name={c.author_name} className="size-6" /><span className="font-medium">{c.author_name}</span><RoleBadge role={c.author_role} /><Badge variant={K.variant}><K.icon />{K.label}</Badge><span className="ml-auto text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>{(c.author_id === user?.id || b.isManager) && <Button size="icon-sm" variant="ghost" onClick={async () => { await api.del(`/api/buildings/${b.id}/documents/${doc.id}/comments/${c.id}`); reload(); }}><Trash2 /></Button>}</div>
      <div className="mt-2 whitespace-pre-wrap">{c.body}</div></div>; })}{data && !data.length && <p className="text-sm text-muted-foreground">Nog geen opmerkingen.</p>}</div>
    {canComment && <form className="grid gap-3 border-t pt-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/documents/${doc.id}/comments`, { body, kind }); setBody(""); reload(); } catch (err) { setError(err); } }}>
      <Select value={kind} onValueChange={setKind}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(KIND).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
      <Textarea required placeholder={kind === "finding" ? "Beschrijf de onregelmatigheid; de syndicus en raad worden per e-mail verwittigd." : "Opmerking…"} value={body} onChange={(e) => setBody(e.target.value)} />
      <ErrorBox error={error} /><Button className="w-fit">Toevoegen</Button></form>}
  </DialogContent></Dialog>;
}
