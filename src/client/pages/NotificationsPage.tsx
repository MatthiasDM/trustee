import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, Calendar, CheckCheck, Clock, Eye, FileText, Gavel, HelpCircle, Megaphone, MessageSquare, RefreshCw, UserCog, Vote, Wrench } from "lucide-react";
import { useFetch } from "../components/Layout";
import { Empty, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { api, timeAgo } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Notification } from "../../shared/types";
import { cn } from "@/lib/utils";

const ICON: Record<string, any> = { question: HelpCircle, announcement: Megaphone, incident: Wrench, comment: MessageSquare, poll: Vote, poll_closed: Vote, meeting: Calendar, meeting_reminder: Clock, minutes: FileText, document: FileText, broadcast: Megaphone, post_status: RefreshCw, inspection: Eye, agenda: Gavel, mandate: UserCog, document_comment: FileText };

export function NotificationsPage() {
  const { setUnread } = useAuth();
  const { data, loading, reload } = useFetch<{ items: (Notification & { building_name?: string })[]; unread: number }>("/api/notifications");
  useEffect(() => { if (data) setUnread(data.unread); }, [data]);
  const markAll = async () => { await api.post("/api/notifications/read", {}); reload(); };
  return <div className="max-w-3xl">
    <PageHeader title="Meldingen" actions={data?.unread ? <Button variant="outline" onClick={markAll}><CheckCheck />Alles gelezen</Button> : undefined} />
    {loading ? <Spinner /> : !data?.items.length ? <Empty icon={<BellOff />} title="Geen meldingen" /> :
      <div className="divide-y rounded-xl border bg-card shadow-xs">{data.items.map((n) => { const I = ICON[n.type] ?? Bell; return <Link key={n.id} to={n.link ?? "/"} onClick={() => !n.read_at && api.post("/api/notifications/read", { ids: [n.id] })} className={cn("flex gap-3 px-4 py-3 transition hover:bg-muted/50", !n.read_at && "bg-primary/5")}>
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", !n.read_at ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}><I className="size-4" /></div>
        <div className="min-w-0 flex-1"><div className={cn("text-sm", !n.read_at ? "font-semibold" : "font-medium")}>{n.title}</div>{n.body && <div className="truncate text-sm text-muted-foreground">{n.body}</div>}<div className="mt-0.5 text-xs text-muted-foreground">{n.building_name ? `${n.building_name} · ` : ""}{timeAgo(n.created_at)}</div></div>
        {!n.read_at && <span className="mt-2 size-2 rounded-full bg-primary" />}
      </Link>; })}</div>}
  </div>;
}
