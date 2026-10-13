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

const TYPE_ICON = { question: HelpCircle, announcement: Megaphone, incident: Wrench } as const;
const TYPE_LABEL: Record<string, string> = { question: "Vraag", announcement: "Mededeling", incident: "Melding" };

export function PostsPage() {
  const b = useBuilding();
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState(sp.get("type") ?? "all");
  const [status, setStatus] = useState("all");
  const posts = useFetch<Post[]>(`/api/buildings/${b.id}/posts?${type !== "all" ? `type=${type}&` : ""}${status !== "all" ? `status=${status}` : ""}`);
  const newType = sp.get("new");
  const nav = useNavigate();
  return <div>
    <PageHeader title="Vragen & meldingen" subtitle="Stel een vraag, meld een probleem of lees mededelingen van de syndicus." actions={<><Button variant="outline" onClick={() => setSp({ new: "question" })}><HelpCircle />Vraag</Button><Button variant="outline" onClick={() => setSp({ new: "incident" })}><Wrench />Melding</Button>{b.isBoard && <Button onClick={() => setSp({ new: "announcement" })}><Megaphone />Mededeling</Button>}</>} />
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Tabs value={type} onValueChange={setType}><TabsList><TabsTrigger value="all">Alles</TabsTrigger><TabsTrigger value="announcement"><Megaphone />Mededelingen</TabsTrigger><TabsTrigger value="question"><HelpCircle />Vragen</TabsTrigger><TabsTrigger value="incident"><Wrench />Meldingen</TabsTrigger></TabsList></Tabs>
      <Select value={status} onValueChange={setStatus}><SelectTrigger size="sm" className="ml-auto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle statussen</SelectItem>{Object.entries(STATUS_LABELS).filter(([k]) => k !== "draft").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
    </div>
    {posts.loading ? <Spinner /> : !posts.data?.length ? <Empty icon={<MessageSquare />} title="Nog geen berichten" hint="Wees de eerste om een vraag te stellen." /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{posts.data.map((p) => { const I = TYPE_ICON[p.type]; return <Link key={p.id} to={`/b/${b.id}/posts/${p.id}`} className="flex gap-3 px-4 py-3.5 transition hover:bg-muted/50">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><I className="size-4" /></div>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{p.pinned ? <Pin className="size-3.5 text-primary" /> : null}{p.title}{p.visibility === "syndicus" && <Badge variant="secondary"><Lock />privé</Badge>}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{p.author_name}</span><RoleBadge role={p.author_role} /><span>· {timeAgo(p.updated_at)}</span><span className="flex items-center gap-1">· <MessageSquare className="size-3" />{p.comment_count}</span><StatusBadge status={p.status} /><PriorityBadge priority={p.priority} /></div></div>
      </Link>; })}</div>}
    {newType && <NewPostModal type={newType} onClose={() => setSp({})} onDone={(id) => nav(`/b/${b.id}/posts/${id}`)} />}
  </div>;
}

function NewPostModal({ type, onClose, onDone }: { type: string; onClose: () => void; onDone: (id: string) => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ type, title: "", body: "", priority: "normal", visibility: "all", pinned: false });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => setF((p) => ({ ...p, type })), [type]);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { const r = await api.post<{ id: string }>(`/api/buildings/${b.id}/posts`, f); onDone(r.id); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Nieuwe {TYPE_LABEL[f.type]?.toLowerCase() ?? "bericht"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="question">Vraag</SelectItem><SelectItem value="incident">Melding (schade, defect, overlast)</SelectItem>{b.isBoard && <SelectItem value="announcement">Mededeling</SelectItem>}</SelectContent></Select></Field>
      <Field label="Titel"><Input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.type === "incident" ? "bv. Lift defect op verdieping 3" : "bv. Wanneer wordt de gevel gereinigd?"} /></Field>
      <Field label="Bericht"><Textarea className="min-h-36" required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
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
  const { data, loading, reload } = useFetch<{ post: Post; comments: Comment[]; attachments: any[] }>(`/api/buildings/${b.id}/posts/${postId}`);
  const [body, setBody] = useState(""); const [isAnswer, setIsAnswer] = useState(false); const [error, setError] = useState<unknown>(null);
  if (loading || !data) return <Spinner />;
  const { post, comments, attachments } = data;
  const I = TYPE_ICON[post.type];
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
      {attachments.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{attachments.map((a) => <Badge key={a.id} variant="secondary" asChild><a href={`/api/buildings/${b.id}/documents/${a.id}/download?inline=1`} target="_blank" rel="noreferrer">{a.name}</a></Badge>)}</div>}
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
