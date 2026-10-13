import { useState } from "react";
import { FileText, Paperclip, Plus, X } from "lucide-react";
import { useBuilding } from "./Layout";
import { Button } from "./ui/button";
import { PickerDialog } from "../ledger/DocumentPicker";
import { fmtSize } from "../lib/api";
import { DOC_CATEGORIES, type Doc, type PollDocument } from "../../shared/types";

const POLL_CATEGORIES = ["offerte", "verslag_av", "contract", "verzekering", "statuten", "reglement", "factuur", "overig"];
const PICKER = { title: "Document koppelen", description: "Kies een bestaand stuk uit Documenten of upload een nieuw (bv. de offerte waarover gestemd wordt). Een nieuwe upload komt ook onder Documenten › Offertes & facturen terecht.", folderMatch: /offerte/i, categories: POLL_CATEGORIES, defaultCategory: POLL_CATEGORIES[0] };

/**
 * Meerdere documentreferenties kiezen (bv. bij een stemming): lijst van gekoppelde stukken met verwijderknop
 * en een kiezer om er een toe te voegen. `value` zijn document-ids; `docs` de bekende metadata om namen te tonen.
 */
export function DocumentRefs({ value, docs, onChange, label = "Document koppelen" }: { value: string[]; docs: PollDocument[]; onChange: (ids: string[], docs: PollDocument[]) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const pick = (d: Doc) => { if (!value.includes(d.id)) onChange([...value, d.id], [...docs, { id: d.id, name: d.name, category: d.category, size: d.size, mime: d.mime }]); setOpen(false); };
  const remove = (id: string) => onChange(value.filter((x) => x !== id), docs.filter((d) => d.id !== id));
  return <div className="grid gap-2">
    {value.length > 0 && <ul className="divide-y rounded-lg border">{value.map((id) => { const d = docs.find((x) => x.id === id); return <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm"><Paperclip className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{d?.name ?? id}</span>{d && <span className="hidden text-xs text-muted-foreground sm:inline">{DOC_CATEGORIES[d.category] ?? d.category} · {fmtSize(d.size)}</span>}<Button type="button" size="icon-sm" variant="ghost" aria-label="Koppeling verwijderen" onClick={() => remove(id)}><X /></Button></li>; })}</ul>}
    <div><Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><Plus />{label}</Button></div>
    {open && <PickerDialog options={{ ...PICKER, exclude: value }} onClose={() => setOpen(false)} onPick={pick} />}
  </div>;
}

/** Alleen-lezen lijst van gekoppelde documenten met downloadlinks. */
export function DocumentRefList({ docs }: { docs: PollDocument[] }) {
  const b = useBuilding();
  if (!docs.length) return null;
  return <ul className="grid gap-1.5">{docs.map((d) => <li key={d.id}><a className="inline-flex max-w-full items-center gap-1.5 text-sm text-primary hover:underline" href={`/api/buildings/${b.id}/documents/${d.id}/download?inline=1`} target="_blank" rel="noreferrer"><FileText className="size-4 shrink-0" /><span className="truncate">{d.name}</span><span className="shrink-0 text-xs text-muted-foreground">({DOC_CATEGORIES[d.category] ?? d.category}, {fmtSize(d.size)})</span></a></li>)}</ul>;
}
