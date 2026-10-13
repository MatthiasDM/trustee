import { Link } from "react-router-dom";
import { AlertTriangle, Calendar, ClipboardCheck, Eye, Gavel, ListChecks, UserCog } from "lucide-react";
import { useBuilding, useFetch } from "./Layout";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { fmtDate, fmtDateTime } from "../lib/api";
import { cn } from "@/lib/utils";

/** Toont de organen van de VME in de wettelijke hiërarchie: AV beslist, raad en commissaris controleren, syndicus voert uit. */
export function OrgansCard() {
  const b = useBuilding();
  const { data } = useFetch<any>(`/api/buildings/${b.id}/organs`);
  if (!data) return null;
  const Holder = ({ list, empty }: { list: any[]; empty: string }) => list.length ? <div className="flex flex-wrap gap-1.5">{list.map((m) => <Badge key={m.id} variant={m.expiring ? "warning" : "secondary"} className="font-normal">{m.name}{m.function_title ? ` (${m.function_title})` : ""} · tot {fmtDate(m.end_date)}</Badge>)}</div> : <span className="text-xs text-muted-foreground">{empty}</span>;
  const Organ = ({ icon: I, title, sub, children, className }: any) => <div className={cn("rounded-lg border p-3", className)}><div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><I className="size-4 text-primary" />{title}</div><div className="mb-2 text-xs text-muted-foreground">{sub}</div>{children}</div>;
  return <div className="mb-6 rounded-xl border bg-card p-5 shadow-xs">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">Organen van de VME</h2><p className="text-sm text-muted-foreground">De vereniging van mede-eigenaars beslist via de algemene vergadering. Raad en commissaris houden toezicht. De syndicus voert uit. <Link to="/help?tab=wet" className="text-primary hover:underline">Wettelijk kader</Link></p></div><Button variant="outline" size="sm" asChild><Link to={`/b/${b.id}/members?tab=mandates`}><UserCog />Mandaten</Link></Button></div>
    <div className="grid gap-3 lg:grid-cols-4">
      <Organ icon={Gavel} title="Algemene vergadering" sub="Hoogste orgaan · alle mede-eigenaars, stemmen naar aandelen" className="border-primary/40 bg-primary/5">
        {data.av.next ? <Link to={`/b/${b.id}/meetings`} className="text-sm hover:text-primary"><Calendar className="mr-1 inline size-3.5" />{data.av.next.title} · {fmtDateTime(data.av.next.starts_at)}</Link> : <span className="text-xs text-muted-foreground">Nog geen volgende AV gepland</span>}
        {data.av.proposed_items > 0 && <div className="mt-1.5"><Badge variant="info"><ListChecks />{data.av.proposed_items} voorgesteld agendapunt{data.av.proposed_items > 1 ? "en" : ""}</Badge></div>}
      </Organ>
      <Organ icon={Eye} title="Raad van mede-eigendom" sub={data.raad_required ? "Verplicht (≥ 20 kavels) · toezicht op de syndicus" : "Facultatief (< 20 kavels) · toezicht op de syndicus"}><Holder list={data.raad} empty="Niet samengesteld" /></Organ>
      <Organ icon={ClipboardCheck} title="Commissaris van de rekeningen" sub="Jaarlijks door de AV · controleert de rekeningen"><Holder list={data.commissaris} empty="Niet aangewezen" /></Organ>
      <Organ icon={UserCog} title="Syndicus" sub="Aangesteld door de AV · max. 3 jaar · voert beslissingen uit, houdt de boekhouding"><Holder list={data.syndicus} empty="Geen actief mandaat" /></Organ>
    </div>
    {data.warnings.length > 0 && b.isBoard && <ul className="mt-4 space-y-1">{data.warnings.map((w: string) => <li key={w} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</li>)}</ul>}
  </div>;
}
