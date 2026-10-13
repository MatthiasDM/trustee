import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, HelpCircle, Lock, Megaphone, MessageSquare, Pin, PinOff, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, PageHeader, PriorityBadge, RoleBadge, Spinner, StatusBadge, STATUS_LABELS, UserAvatar } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Separator } from "../components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { api, fmtDateTime, timeAgo } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Comment, Post } from "../../shared/types";
import { useT } from "../lib/i18n";
import { DocumentPicker } from "../ledger/DocumentPicker";
import { Building, CalendarClock, MapPin, Paperclip, Receipt } from "lucide-react";

const TYPE_ICON = { question: HelpCircle, announcement: Megaphone, incident: Wrench } as const;
const TYPE_LABEL: Record<string, string> = { question: "Vraag", announcement: "Mededeling", incident: "Melding" };

export function PostsPage() {
  const b = useBuilding(); const t = useT();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(sp.get("type") ?? "all");
  const [status, setStatus] = useState("all");
  const posts = useFetch<Post[]>(`/api/buildings/${b.id}/posts?${type !== "all" ? `type=${type}&` : ""}${status !== "all" ? `status=${status}` : ""}`);
  const newType = sp.get("new");
  const nav = useNavigate();
  return <div>
    <PageHeader title={t("Vragen & meldingen")} subtitle={t("Stel een vraag, meld een probleem of lees mededelingen van de syndicus.")} actions={<><Button variant="outline" onClick={() => setSp({ new: "question" })}><HelpCircle />{t("Vraag")}</Button><Button variant="outline" onClick={() => setSp({ new: "incident" })}><Wrench />{t("Melding")}</Button>{b.isBoard && <Button onClick={() => setSp({ new: "announcement" })}><Megaphone />{t("Mededeling")}</Button>}</>} />
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Tabs value={type} onValueChange={setType}><TabsList><TabsTrigger value="all">{t("Alles")}</TabsTrigger><TabsTrigger value="announcement"><Megaphone />Mededelingen</TabsTrigger><TabsTrigger value="question"><HelpCircle />Vragen</TabsTrigger><TabsTrigger value="incident"><Wrench />Meldingen</TabsTrigger></TabsList></Tabs>
      <Select value={status} onValueChange={setStatus}><SelectTrigger size="sm" className="ml-auto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle statussen</SelectItem>{Object.entries(STATUS_LABELS).filter(([k]) => k !== "draft").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
    </div>
    {posts.loading ? <Spinner /> : !posts.data?.length ? <Empty icon={<MessageSquare />} title={t("Nog geen berichten")} hint="Wees de eerste om een vraag te stellen." /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{posts.data.map((p) => { const I = TYPE_ICON[p.type]; return <Link key={p.id} to={`/b/${b.id}/posts/${p.id}`} className="flex gap-3 px-4 py-3.5 transition hover:bg-muted/50">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><I className="size-4" /></div>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{p.pinned ? <Pin className="size-3.5 text-primary" /> : null}{p.title}{p.visibility === "syndicus" && <Badge variant="secondary"><Lock />privé</Badge>}{(p as any).supplier_name && <Badge variant="outline"><Building />{(p as any).supplier_name}</Badge>}{(p as any).due_date && p.status !== "resolved" && p.status !== "closed" && <Badge variant={(p as any).due_date < new Date().toISOString().slice(0, 10) ? "red" : "secondary"}><CalendarClock />{(p as any).due_date}</Badge>}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{p.author_name}</span><RoleBadge role={p.author_role} /><span>· {timeAgo(p.updated_at)}</span><span className="flex items-center gap-1">· <MessageSquare className="size-3" />{p.comment_count}</span><StatusBadge status={p.status} /><PriorityBadge priority={p.priority} /></div></div>
      </Link>; })}</div>}
    {newType && <NewPostModal type={newType} onClose={() => setSp({})} onDone={(id) => nav(`/b/${b.id}/posts/${id}`)} />}
  </div>;
}

function NewPostModal({ type, onClose, onDone }: { type: string; onClose: () => void; onDone: (id: string) => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ type, title: "", body: "", priority: "normal", visibility: "all", pinned: false, location: "" });
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => setF((p) => ({ ...p, type })), [type]);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { const r = await api.post<{ id: string }>(`/api/buildings/${b.id}/posts`, { ...f, location: f.location || null, attachments: attachments.map((a) => a.id) }); onDone(r.id); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Nieuwe {TYPE_LABEL[f.type]?.toLowerCase() ?? "bericht"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="question">Vraag</SelectItem><SelectItem value="incident">Melding (schade, defect, overlast)</SelectItem>{b.isBoard && <SelectItem value="announcement">Mededeling</SelectItem>}</SelectContent></Select></Field>
      <Field label="Titel"><Input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.type === "incident" ? "bv. Lift defect op verdieping 3" : "bv. Wanneer wordt de gevel gereinigd?"} /></Field>
      <Field label="Bericht"><Textarea className="min-h-36" required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      {f.type === "incident" && <Field label="Plaats" hint="bv. lift, inkomhal, garage -1, verdieping 2"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>}
      <Field label="Bijlagen (foto, offerte)" hint="Foto's helpen de syndicus en de leverancier; ze komen ook onder Documenten."><div className="flex flex-wrap items-center gap-2">{attachments.map((a) => <Badge key={a.id} variant="secondary"><Paperclip />{a.name}</Badge>)}<DocumentPicker value="" onChange={(id, doc) => { if (id && doc) setAttachments([...attachments, { id, name: doc.name }]); }} suggestedName={f.title} /></div></Field>
      {f.type !== "announcement" && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prioriteit"><Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Laag</SelectItem><SelectItem value="normal">Normaal</SelectItem><SelectItem value="high">Hoog</SelectItem><SelectItem value="urgent">Dringend</SelectItem></SelectContent></Select></Field>
        <Field label="Zichtbaarheid"><Select value={f.visibility} onValueChange={(v) => setF({ ...f, visibility: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle leden</SelectItem><SelectItem value="syndicus">Enkel de syndicus (privé)</SelectItem></SelectContent></Select></Field>
      </div>}
      {b.isManager && f.type === "announcement" && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.pinned} onCheckedChange={(v) => setF({ ...f, pinned: !!v })} />Vastpinnen bovenaan</label>}
      {f.type === "announcement" && <p className="text-xs text-muted-foreground">Alle leden ontvangen een push- en e-mailmelding.</p>}
      <ErrorBox error={error} />
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={busy}>Plaatsen</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function PostDetailPage() {
  const b = useBuilding();
  const { postId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, loading, reload } = useFetch<{ post: Post & any; comments: Comment[]; attachments: any[]; ledger: any[] }>(`/api/buildings/${b.id}/posts/${postId}`);
  const suppliers = useFetch<any[]>(b.isBoard ? `/api/buildings/${b.id}/suppliers` : null);
  const members = useFetch<{ members: { user_id: string; name: string; role: string }[] }>(b.isBoard ? `/api/buildings/${b.id}/members` : null);
  const [body, setBody] = useState(""); const [isAnswer, setIsAnswer] = useState(false); const [error, setError] = useState<unknown>(null);
  if (loading || !data) return <Spinner />;
  const { post, comments, attachments, ledger } = data;
  const patch = async (p: any) => { await api.patch(`/api/buildings/${b.id}/posts/${post.id}`, p); reload(); };
  const I = TYPE_ICON[post.type as keyof typeof TYPE_ICON];
  const mine = post.author_id === user?.id;
  const canManage = mine || b.isBoard;
  const setStatus = async (status: string) => { await api.patch(`/api/buildings/${b.id}/posts/${post.id}`, { status }); reload(); toast.success("Status bijgewerkt"); };
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(null); try { await api.post(`/api/buildings/${b.id}/posts/${post.id}/comments`, { body, is_answer: isAnswer }); setBody(""); setIsAnswer(false); reload(); } catch (err) { setError(err); } };
  const del = async () => { if (!confirm("Bericht verwijderen?")) return; await api.del(`/api/buildings/${b.id}/posts/${post.id}`); nav(`/b/${b.id}/posts`); };
  return <div className="max-w-3xl">
    <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3"><Link to={`/b/${b.id}/posts`}><ArrowLeft />Terug</Link></Button>
    <div className="rounded-xl border bg-card p-6 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div><div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><I className="size-3.5" />{TYPE_LABEL[post.type]}{post.visibility === "syndicus" ? <><span>·</span><Lock className="size-3" />privé aan syndicus</> : null}</div><h1 className="text-xl font-semibold tracking-tight">{post.pinned ? <Pin className="mr-1 inline size-4 text-primary" /> : null}{post.title}</h1></div>
        <div className="flex shrink-0 items-center gap-1"><StatusBadge status={post.status} /><PriorityBadge priority={post.priority} /></div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm"><UserAvatar name={post.author_name} /><span className="font-medium">{post.author_name}</span><RoleBadge role={post.author_role} /><span className="text-muted-foreground">· {fmtDateTime(post.created_at)}</span></div>
      <div className="mt-4 text-[15px] leading-relaxed whitespace-pre-wrap">{post.body}</div>
      {post.location && <div className="mt-3 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-4" />{post.location}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">{attachments.map((a) => <Badge key={a.id} variant="secondary" asChild><a href={`/api/buildings/${b.id}/documents/${a.id}/download?inline=1`} target="_blank" rel="noreferrer"><Paperclip />{a.name}</a></Badge>)}{canManage && post.status !== "closed" && <DocumentPicker value="" onChange={async (id) => { if (id) { await api.post(`/api/buildings/${b.id}/posts/${post.id}/attachments`, { document_id: id }); reload(); } }} suggestedName={post.title} />}</div>
      {post.type === "incident" && (b.isBoard || post.supplier_name || post.due_date) && <div className="mt-5 rounded-lg border bg-muted/30 p-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Wrench className="size-4 text-primary" />Opvolging</h3>
        {b.isBoard ? <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-medium">Leverancier</label><Select value={post.supplier_id ?? "__none__"} onValueChange={(v) => patch({ supplier_id: v === "__none__" ? null : v })}><SelectTrigger className="w-full"><SelectValue placeholder="Toewijzen…" /></SelectTrigger><SelectContent><SelectItem value="__none__">— geen —</SelectItem>{(suppliers.data ?? []).filter((x) => x.active).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}{x.category ? ` (${x.category})` : ""}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="mb-1 block text-xs font-medium">Opvolger (intern)</label><Select value={post.assignee_id ?? "__none__"} onValueChange={(v) => patch({ assignee_id: v === "__none__" ? null : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">— geen —</SelectItem>{(members.data?.members ?? []).filter((m) => m.role !== "huurder").map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="mb-1 block text-xs font-medium">Streefdatum</label><Input type="date" defaultValue={post.due_date ?? ""} onBlur={(e) => e.target.value !== (post.due_date ?? "") && patch({ due_date: e.target.value || null })} /></div>
          <div><label className="mb-1 block text-xs font-medium">Geraamde kost (€)</label><Input type="number" step="0.01" defaultValue={post.cost_estimate ?? ""} onBlur={(e) => patch({ cost_estimate: e.target.value ? +e.target.value : null })} /></div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium">Plaats</label><Input defaultValue={post.location ?? ""} onBlur={(e) => e.target.value !== (post.location ?? "") && patch({ location: e.target.value || null })} /></div>
        </div> : <div className="flex flex-wrap gap-3 text-sm">{post.supplier_name && <span className="flex items-center gap-1"><Building className="size-4 text-muted-foreground" />{post.supplier_name}</span>}{post.due_date && <span className="flex items-center gap-1"><CalendarClock className="size-4 text-muted-foreground" />streefdatum {fmtDateTime(post.due_date).slice(0, 10)}</span>}</div>}
        {b.isBoard && post.supplier_name && <div className="mt-3 text-xs text-muted-foreground">{post.supplier_email && <span className="mr-3">{post.supplier_email}</span>}{post.supplier_phone && <span className="mr-3">{post.supplier_phone}</span>}{post.assignee_name && <span>opgevolgd door {post.assignee_name}</span>}</div>}
        {b.isBoard && ledger.length > 0 && <div className="mt-3"><div className="mb-1 flex items-center gap-1 text-xs font-medium"><Receipt className="size-3.5" />Boekingen bij {post.supplier_name} sinds de melding</div><ul className="text-xs text-muted-foreground">{ledger.map((e: any) => <li key={e.id}>{e.date} · {e.description} · € {(e.amount ?? 0).toFixed(2)}</li>)}</ul></div>}
      </div>}
      {canManage && <><Separator className="my-5" /><div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status:</span>
        {(post.type === "incident" ? ["open", "in_progress", "resolved", "closed"] : ["open", "answered", "closed"]).map((s) => <Button key={s} size="sm" variant={post.status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{STATUS_LABELS[s]}</Button>)}
        {b.isManager && <Button size="sm" variant="ghost" onClick={async () => { await api.patch(`/api/buildings/${b.id}/posts/${post.id}`, { pinned: !post.pinned }); reload(); }}>{post.pinned ? <><PinOff />Losmaken</> : <><Pin />Vastpinnen</>}</Button>}
        {(mine || b.isManager) && <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={del}><Trash2 />Verwijderen</Button>}
      </div></>}
    </div>
    <h2 className="mt-8 mb-3 font-semibold">{comments.length} reactie{comments.length === 1 ? "" : "s"}</h2>
    <div className="space-y-3">{comments.map((c) => <div key={c.id} className={`rounded-xl border bg-card p-4 shadow-xs ${c.is_answer ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20" : ""}`}>
      <div className="flex items-center gap-2 text-sm"><UserAvatar name={c.author_name} className="size-7" /><span className="font-medium">{c.author_name}</span><RoleBadge role={c.author_role} />{c.is_answer ? <Badge variant="success"><CheckCircle2 />Officieel antwoord</Badge> : null}<span className="ml-auto text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
        {(c.author_id === user?.id || b.isManager) && <Button variant="ghost" size="icon-sm" onClick={async () => { if (confirm("Reactie verwijderen?")) { await api.del(`/api/buildings/${b.id}/posts/${post.id}/comments/${c.id}`); reload(); } }}><Trash2 /></Button>}</div>
      <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{c.body}</div></div>)}</div>
    {post.status !== "closed" ? <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <Textarea placeholder="Schrijf een reactie…" required value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center gap-3">{b.isBoard && <label className="flex items-center gap-2 text-sm"><Checkbox checked={isAnswer} onCheckedChange={(v) => setIsAnswer(!!v)} />Markeren als officieel antwoord</label>}<Button className="ml-auto">Reageren</Button></div>
      <ErrorBox error={error} />
    </form> : <p className="mt-4 text-sm text-muted-foreground">Dit bericht is gesloten.</p>}
  </div>;
}
