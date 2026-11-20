import { useEffect, useState } from "react";
import { ExternalLink, Video } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "./Layout";
import { ErrorBox } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { api } from "../lib/api";
import { MAJORITY_LABELS } from "../../shared/types";

export interface RemoteState { allowed: boolean; joined: boolean; can_manage: boolean; info: string | null; url: string | null; units: { unit_id: string; label: string; shares: number; proxy: boolean }[]; items: { id: string; title: string; required_majority: keyof typeof MAJORITY_LABELS; open: boolean; my_choice: string | null; excluded: boolean; cast?: { unit_id: string; choice: string }[] }[] }
const CHOICE: [string, string][] = [["for", "Vóór"], ["against", "Tegen"], ["abstain", "Onthouding"]];

/** Deelname vanop afstand (art. 3.87 §1 BW): link en afspraken, en de stemrondes die de voorzitter opent. Ververst zichzelf tijdens de vergadering. */
export function RemoteParticipation({ meeting }: { meeting: any }) {
  const b = useBuilding();
  const active = !!meeting.remote_allowed && (meeting.my_rsvp === "remote" || !!meeting.can_manage);
  const { data, reload } = useFetch<RemoteState>(active ? `/api/buildings/${b.id}/meetings/${meeting.id}/remote` : null);
  const [error, setError] = useState<unknown>(null);
  // tijdens de vergadering (van een uur vooraf tot acht uur erna) om de vijf seconden kijken of er een stemronde openging
  const start = new Date(meeting.starts_at).getTime(); const live = active && meeting.my_rsvp === "remote" && Date.now() > start - 3600_000 && Date.now() < start + 8 * 3600_000 && meeting.minutes_status !== "final";
  useEffect(() => { if (!live) return; const h = setInterval(reload, 5000); return () => clearInterval(h); }, [live]);
  if (!meeting.remote_allowed) return null;
  if (!active) return <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="info"><Video />Deelname vanop afstand mogelijk</Badge>Kies "Vanop afstand" bij je aanwezigheid; je krijgt dan de link en stemt zelf.</p>;
  if (!data) return null;
  const vote = async (itemId: string, choice: string) => { setError(null); try { await api.put(`/api/buildings/${b.id}/meetings/${meeting.id}/agenda/${itemId}/ballot`, { choice }); toast.success("Je stem is geregistreerd"); reload(); } catch (e) { setError(e); } };
  const open = data.items.filter((i) => i.open);
  return <div className="mt-4 rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><Video className="size-4 text-primary" /><span className="font-medium">Deelname vanop afstand</span>{data.joined && <Badge variant="success">aangemeld</Badge>}
      {data.url ? <Button size="sm" variant="outline" className="ml-auto" asChild><a href={data.url} target="_blank" rel="noreferrer"><ExternalLink />Videovergadering openen</a></Button> : <span className="ml-auto text-xs text-amber-700 dark:text-amber-400">Nog geen link ingevuld</span>}</div>
    {data.info && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{data.info}</p>}
    {data.joined && <>
      <p className="mt-2 text-xs text-muted-foreground">Je stemt voor kavel {data.units.map((u) => `${u.label}${u.proxy ? " (volmacht)" : ""}`).join(", ")}. De voorzitter opent per agendapunt een stemronde; je stem verschijnt hier en telt mee zodra de beslissing wordt vastgelegd.</p>
      {open.length === 0 && <p className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Er is nu geen stemronde open.</p>}
      {data.items.map((i) => <div key={i.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"><div className="min-w-0 flex-1"><span className="font-medium">{i.title}</span> <span className="text-xs text-muted-foreground">{MAJORITY_LABELS[i.required_majority]}</span></div>
        {i.excluded ? <Badge variant="warning">belangenconflict: je stemt niet mee</Badge> : i.open ? <div className="flex gap-1">{CHOICE.map(([v, l]) => <Button key={v} size="sm" variant={i.my_choice === v ? "default" : "outline"} onClick={() => vote(i.id, v)}>{l}</Button>)}</div> : <Badge variant="secondary">gesloten{i.my_choice ? ` · je stemde ${CHOICE.find(([v]) => v === i.my_choice)?.[1].toLowerCase()}` : " · niet gestemd"}</Badge>}</div>)}
    </>}
    <ErrorBox error={error} />
  </div>;
}
