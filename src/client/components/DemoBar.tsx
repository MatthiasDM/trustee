import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FlaskConical, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { RoleBadge } from "./ui";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

/** Demobalk onderaan: met één klik van gebruiker wisselen binnen hetzelfde demogebouw; demo beëindigen. */
export function DemoBar() {
  const { user, demo, refresh } = useAuth();
  const nav = useNavigate(); const { buildingId } = useParams();
  const [busy, setBusy] = useState(false);
  if (!user || !demo) return null;
  const switchTo = async (id: string) => {
    if (id === user.id || busy) return; setBusy(true);
    try { await api.post("/api/demo/switch", { user_id: id }); await refresh(); const b = demo.users.find((u) => u.id === id)?.building_id; nav(buildingId || !b ? location.pathname : `/b/${b}`); toast.success(`Je bent nu ${demo.users.find((u) => u.id === id)?.name}`); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-amber-50/95 backdrop-blur dark:bg-amber-950/80" role="region" aria-label="Demo">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200"><FlaskConical className="size-4" />Demo · wissel van gebruiker:</span>
      <div className="flex flex-wrap gap-1.5">{demo.users.map((u) => <button key={u.id} type="button" disabled={busy} onClick={() => switchTo(u.id)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition cursor-pointer", u.id === user.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent")} aria-pressed={u.id === user.id} aria-label={`Wissel naar ${u.name}`}><span>{u.name}</span><RoleBadge role={u.role} /></button>)}</div>
      <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Fictieve gegevens · verdwijnt na {demo.ttl_hours} u zonder activiteit</span>
      <Button size="sm" variant="ghost" className="text-amber-900 dark:text-amber-200" onClick={async () => { if (confirm("Demo beëindigen en alles verwijderen?")) { await api.post("/api/demo/end"); nav("/demo", { replace: true }); await refresh(); } }}><LogOut />Beëindigen</Button>
    </div>
  </div>;
}
