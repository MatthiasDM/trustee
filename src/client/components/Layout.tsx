import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { Bell, BookOpen, Briefcase, Building2, Calculator, Calendar, ChevronsUpDown, FileText, Home, LogOut, Menu, MessageSquare, Moon, Settings, Sun, Users, Vote } from "lucide-react";
import { Toaster } from "sonner";
import { useAuth } from "../lib/auth";
import { ConsentGate } from "./ConsentGate";
import { DemoBar } from "./DemoBar";
import { LandingPage } from "../pages/LandingPage";
import { Outlet as RouterOutlet } from "react-router-dom";

/** Handleiding zonder account: dezelfde pagina in een eenvoudige openbare schil. */
function PublicHelp() {
  return <div className="min-h-screen bg-muted/40"><div className="mx-auto max-w-6xl px-4 py-4 sm:px-6"><div className="mb-4 flex items-center justify-between"><Link to="/" className="flex items-center gap-2.5"><img src="/icon.svg" className="size-8 rounded-lg" alt="" /><span className="font-semibold tracking-tight">Trustee</span></Link><Button variant="outline" size="sm" asChild><Link to="/login">Aanmelden</Link></Button></div><RouterOutlet /></div></div>;
}
import { LegalLinks } from "../pages/LegalPage";
import { api } from "../lib/api";
import { RoleBadge, Spinner, UserAvatar } from "./ui";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { TooltipProvider } from "./ui/tooltip";
import { cn } from "@/lib/utils";
import { useT } from "../lib/i18n";

const NAV = [
  { to: "", label: "Overzicht", icon: Home, end: true },
  { to: "meetings", label: "Algemene vergadering", icon: Calendar },
  { to: "polls", label: "Stemmingen", icon: Vote },
  { to: "posts", label: "Vragen & meldingen", icon: MessageSquare },
  { to: "documents", label: "Documenten", icon: FileText },
  { to: "ledger", label: "Boekhouding", icon: Calculator },
  { to: "members", label: "Mede-eigenaars & organen", icon: Users },
  { to: "settings", label: "Instellingen", icon: Settings },
];

function useTheme() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && matchMedia("(prefers-color-scheme: dark)").matches); } catch { return false; } });
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {} }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function AppShell() {
  const { user, loading, unread, logout, buildings, orgs, demo } = useAuth();
  const nav = useNavigate();
  const { buildingId } = useParams();
  const [open, setOpen] = useState(false);
  const t = useT();
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const publicRoot = location.pathname === "/" || location.pathname === "/help"; // startpagina en handleiding zijn openbaar
  useEffect(() => { if (!loading && !user && !publicRoot) nav(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }, [loading, user, nav, publicRoot]);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  if (loading) return <Spinner />;
  if (!user) return location.pathname === "/" ? <LandingPage /> : location.pathname === "/help" ? <PublicHelp /> : <Spinner />;
  const current = buildings.find((b) => b.id === buildingId);

  const sidebar = <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="px-4 py-4"><Link to="/" className="flex items-center gap-2.5"><img src="/icon.svg" className="size-8 rounded-lg" alt="" /><span className="text-base font-semibold tracking-tight">Trustee</span></Link></div>
    {current && <div className="px-3 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="flex w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-left text-sm shadow-xs hover:bg-accent cursor-pointer">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"><Building2 className="size-4" /></div>
          <div className="min-w-0 flex-1"><div className="truncate font-medium leading-tight">{current.name}</div><div className="truncate text-[11px] text-muted-foreground">{current.city ?? current.address}</div></div>
          <ChevronsUpDown className="size-4 text-muted-foreground" /></button></DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" align="start"><DropdownMenuLabel className="text-xs text-muted-foreground">{t("Gebouwen")}</DropdownMenuLabel>
          {buildings.map((b) => <DropdownMenuItem key={b.id} onClick={() => nav(`/b/${b.id}`)}><Building2 className="text-muted-foreground" /><span className="truncate">{b.name}</span></DropdownMenuItem>)}
          <DropdownMenuSeparator /><DropdownMenuItem onClick={() => nav("/")}>{t("Alle gebouwen")}</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
      <div className="mt-2 flex flex-wrap items-center gap-1 px-1"><RoleBadge role={current.role} />{!!current.acting && <span className="text-[11px] text-muted-foreground" title="Actief mandaat als (voorlopig) syndicus">voorlopig</span>}</div>
    </div>}
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{current ? t("Jouw VME") : t("Navigatie")}</div>
      {current ? NAV.map((n) => <NavLink key={n.to} end={n.end} to={`/b/${current.id}/${n.to}`} className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-accent/60")}><n.icon className="size-4" />{t(n.label)}</NavLink>)
        : <NavLink to="/" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm bg-sidebar-accent font-medium text-sidebar-accent-foreground"><Building2 className="size-4" />{t("Mijn gebouwen")}</NavLink>}
      {orgs.map((o) => <NavLink key={o.id} to={`/org/${o.id}`} className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-accent/60")}><Briefcase className="size-4" />{t("Kantoor")}: {o.name}</NavLink>)}
      <div className="mt-4 mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("Persoonlijk")}</div>
      <NavLink to="/notifications" className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-accent/60")}><Bell className="size-4" />{t("Meldingen")}{unread > 0 && <Badge className="ml-auto h-5 min-w-5 px-1.5">{unread}</Badge>}</NavLink>
      <NavLink to="/help" className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-accent/60")}><BookOpen className="size-4" />{t("Handleiding")}</NavLink>
    </div>
    <div className="border-t p-3">
      <LegalLinks className="mb-2 block px-2 text-[11px] text-muted-foreground" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent cursor-pointer"><UserAvatar name={user.name} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{user.name}</div><div className="truncate text-xs text-muted-foreground">{user.email}</div></div><ChevronsUpDown className="size-4 text-muted-foreground" /></button></DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" side="top">
          <DropdownMenuItem onClick={toggle}>{dark ? <Sun /> : <Moon />}{dark ? t("Licht thema") : t("Donker thema")}</DropdownMenuItem>
          {current && <DropdownMenuItem onClick={() => nav(`/b/${current.id}/settings`)}><Settings />{t("Instellingen")}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={async () => { await logout(); nav("/login"); }}><LogOut />{t("Afmelden")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </nav>;

  return <TooltipProvider><div className="flex min-h-screen">
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r lg:block" style={demo ? { height: "calc(100vh - var(--demo-bar-h, 56px))" } : undefined}>{sidebar}</aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 px-3 py-2.5 backdrop-blur lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Menu"><Menu /></Button></SheetTrigger><SheetContent className="w-72 p-0">{sidebar}</SheetContent></Sheet>
        <span className="flex-1 truncate font-semibold">{current?.name ?? "Trustee"}</span>
        <Button variant="ghost" size="icon" asChild><Link to="/notifications" className="relative"><Bell />{unread > 0 && <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{unread}</span>}</Link></Button>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8" style={demo ? { paddingBottom: "calc(var(--demo-bar-h, 56px) + 1.5rem)" } : undefined}><Outlet /></main>
      <ConsentGate />
      <DemoBar />
    </div>
    <Toaster richColors position="bottom-center" theme={dark ? "dark" : "light"} />
  </div></TooltipProvider>;
}

export function useBuilding() {
  const { buildingId } = useParams();
  const { buildings } = useAuth();
  const b = buildings.find((x) => x.id === buildingId);
  return { id: buildingId!, role: b?.role ?? "eigenaar", name: b?.name ?? "", isManager: b?.role === "syndicus", isBoard: b?.role === "syndicus" || b?.role === "raad" || b?.role === "commissaris", isOwner: (b?.units ?? 0) > 0 || b?.role === "eigenaar" || b?.role === "raad" || !b };
}

export function useFetch<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!url);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    api.get<T>(url).then((d) => alive && setData(d)).catch((e) => alive && setError(e)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [url, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
