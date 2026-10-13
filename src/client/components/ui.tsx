import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { ROLE_LABELS, type Role } from "../../shared/types";
import { Badge } from "./ui/badge";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import { cn } from "@/lib/utils";

export function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>; }

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
    {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">{icon}</div>}
    <p className="font-medium">{title}</p>{hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}{action && <div className="mt-4">{action}</div>}
  </div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return <div className={cn("grid gap-1.5", className)}><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const issues = (error as any)?.issues as string[] | undefined;
  return <Alert variant="destructive"><AlertCircle /><AlertTitle>{msg}</AlertTitle>{issues && <AlertDescription><ul className="list-disc pl-4">{issues.map((i) => <li key={i}>{i}</li>)}</ul></AlertDescription>}</Alert>;
}

const ROLE_VARIANT: Record<Role, "info" | "violet" | "success" | "warning" | "pink"> = { syndicus: "info", raad: "violet", eigenaar: "success", huurder: "warning", commissaris: "pink" };
export function RoleBadge({ role }: { role?: Role | string | null }) {
  if (!role) return null;
  return <Badge variant={ROLE_VARIANT[role as Role] ?? "secondary"}>{ROLE_LABELS[role as Role] ?? role}</Badge>;
}

export const STATUS_LABELS: Record<string, string> = { open: "Open", answered: "Beantwoord", in_progress: "In behandeling", resolved: "Opgelost", closed: "Gesloten", draft: "Concept" };
const STATUS_VARIANT: Record<string, any> = { open: "warning", answered: "success", in_progress: "info", resolved: "success", closed: "secondary", draft: "outline" };
export function StatusBadge({ status }: { status: string }) { return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{STATUS_LABELS[status] ?? status}</Badge>; }

export const PRIORITY_LABELS: Record<string, string> = { low: "Laag", normal: "Normaal", high: "Hoog", urgent: "Dringend" };
export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal") return null;
  return <Badge variant={priority === "urgent" ? "red" : priority === "high" ? "orange" : "secondary"}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const hue = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 360;
  return <Avatar className={className}><AvatarFallback className="text-white" style={{ background: `oklch(0.6 0.13 ${hue})` }}>{initials}</AvatarFallback></Avatar>;
}

export function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  const long = typeof value === "string" && value.length > 8;
  return <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
    {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{icon}</div>}
    <div className="min-w-0"><div className={cn("font-semibold leading-tight tabular-nums break-words", long ? "text-lg" : "text-2xl")}>{value}</div><div className="text-xs leading-tight text-muted-foreground">{label}</div></div>
  </div>;
}
