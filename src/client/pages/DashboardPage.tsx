import { Link } from "react-router-dom";
import { ArrowRight, Calendar, FileText, HelpCircle, Home, Megaphone, MessageSquare, Pin, Users, Vote, Wrench, AlertTriangle } from "lucide-react";
import { useBuilding, useFetch } from "../components/Layout";
import { OrgansCard } from "../components/OrgansCard";
import { PageHeader, Spinner, Stat, StatusBadge, PriorityBadge } from "../components/ui";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { fmtDateTime, timeAgo } from "../lib/api";
import type { Post, Poll, Meeting, Doc } from "../../shared/types";

const TYPE_ICON = { question: HelpCircle, announcement: Megaphone, incident: Wrench } as const;

function Section({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return <Card className="gap-0 py-0"><CardHeader className="border-b py-3.5"><CardTitle className="text-sm">{title}</CardTitle><CardAction><Button variant="ghost" size="sm" asChild><Link to={to}>Alles <ArrowRight /></Link></Button></CardAction></CardHeader><CardContent className="px-0">{children}</CardContent></Card>;
}
const EmptyRow = ({ text }: { text: string }) => <p className="px-6 py-6 text-sm text-muted-foreground">{text}</p>;

export function DashboardPage() {
  const b = useBuilding();
  const info = useFetch<any>(`/api/buildings/${b.id}`);
  const posts = useFetch<Post[]>(`/api/buildings/${b.id}/posts`);
  const polls = useFetch<Poll[]>(`/api/buildings/${b.id}/polls`);
  const meetings = useFetch<Meeting[]>(`/api/buildings/${b.id}/meetings`);
  const docs = useFetch<Doc[]>(`/api/buildings/${b.id}/documents`);
  if (info.loading || !info.data) return <Spinner />;
  const s = info.data.stats ?? {};
  const upcoming = (meetings.data ?? []).filter((m) => new Date(m.starts_at) > new Date()).sort((a, b2) => a.starts_at.localeCompare(b2.starts_at));
  return <div>
    <PageHeader title={info.data.name} subtitle={`${info.data.address}${info.data.city ? `, ${info.data.postal_code ?? ""} ${info.data.city}` : ""}${info.data.enterprise_number ? ` · KBO ${info.data.enterprise_number}` : ""}`}
      actions={<><Button variant="outline" asChild><Link to={`/b/${b.id}/posts?new=question`}><HelpCircle />Vraag stellen</Link></Button><Button asChild><Link to={`/b/${b.id}/posts?new=incident`}><AlertTriangle />Melding maken</Link></Button></>} />
    <OrgansCard />
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Leden" value={s.members ?? 0} icon={<Users />} /><Stat label="Kavels" value={s.units ?? 0} icon={<Home />} /><Stat label="Documenten" value={s.documents ?? 0} icon={<FileText />} />
      <Stat label="Open vragen" value={s.open_posts ?? 0} icon={<MessageSquare />} /><Stat label="Open stemmingen" value={s.open_polls ?? 0} icon={<Vote />} /><Stat label="Vergaderingen" value={s.upcoming_meetings ?? 0} icon={<Calendar />} />
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Mededelingen & activiteit" to={`/b/${b.id}/posts`}>
        <ul className="divide-y">{(posts.data ?? []).slice(0, 6).map((p) => { const I = TYPE_ICON[p.type]; return <li key={p.id}><Link to={`/b/${b.id}/posts/${p.id}`} className="flex gap-3 px-6 py-3 hover:bg-muted/50"><I className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-sm font-medium">{p.pinned ? <Pin className="size-3 text-primary" /> : null}<span className="truncate">{p.title}</span></div><div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{p.author_name} · {timeAgo(p.updated_at)} <StatusBadge status={p.status} /><PriorityBadge priority={p.priority} /></div></div></Link></li>; })}{posts.data?.length === 0 && <EmptyRow text="Nog geen berichten." />}</ul>
      </Section>
      <div className="space-y-6">
        <Section title="Open stemmingen" to={`/b/${b.id}/polls`}>
          <ul className="divide-y">{(polls.data ?? []).filter((p) => p.status === "open").slice(0, 4).map((p: any) => <li key={p.id}><Link to={`/b/${b.id}/polls/${p.id}`} className="block px-6 py-3 text-sm hover:bg-muted/50"><div className="font-medium">{p.title}</div><div className="mt-0.5 text-xs text-muted-foreground">{p.voted ? "Je hebt gestemd" : "Nog niet gestemd"}{p.closes_at ? ` · sluit ${fmtDateTime(p.closes_at)}` : ""}</div></Link></li>)}{!polls.data?.some((p) => p.status === "open") && <EmptyRow text="Geen open stemmingen." />}</ul>
        </Section>
        <Section title="Komende vergaderingen" to={`/b/${b.id}/meetings`}>
          <ul className="divide-y">{upcoming.slice(0, 3).map((m) => <li key={m.id} className="px-6 py-3 text-sm"><div className="font-medium">{m.title}</div><div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(m.starts_at)}{m.location ? ` · ${m.location}` : ""}</div></li>)}{upcoming.length === 0 && <EmptyRow text="Geen geplande vergaderingen." />}</ul>
        </Section>
        <Section title="Recente documenten" to={`/b/${b.id}/documents`}>
          <ul className="divide-y">{(docs.data ?? []).slice(0, 4).map((d) => <li key={d.id} className="flex items-center justify-between gap-2 px-6 py-2.5 text-sm"><a href={`/api/buildings/${b.id}/documents/${d.id}/download?inline=1`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:text-primary"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{d.name}</span></a><span className="shrink-0 text-xs text-muted-foreground">{timeAgo(d.created_at)}</span></li>)}{docs.data?.length === 0 && <EmptyRow text="Nog geen documenten." />}</ul>
        </Section>
      </div>
    </div>
  </div>;
}
