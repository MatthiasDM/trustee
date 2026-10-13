import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useBuilding } from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { api, fmtDate, fmtSize } from "../lib/api";
import { DOC_CATEGORIES, type Doc, type Folder } from "../../shared/types";

const LEDGER_CATEGORIES = ["factuur", "offerte", "boekhouding", "contract", "verzekering", "overig"];

/**
 * Verantwoordingsstuk kiezen: zoeken in bestaande documenten of een nieuw stuk uploaden.
 * Een nieuwe upload belandt in Documenten (map "Boekhouding & afrekeningen", categorie naar keuze) en is daar ook zichtbaar.
 */
export function DocumentPicker({ value, onChange, suggestedName, id }: { value: string; onChange: (id: string, doc?: Doc) => void; suggestedName?: string; id?: string }) {
  const b = useBuilding();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Doc | null>(null);
  useEffect(() => { if (!value) setSelected(null); else if (!selected || selected.id !== value) api.get<Doc[]>(`/api/buildings/${b.id}/documents`).then((ds) => setSelected(ds.find((d) => d.id === value) ?? null)).catch(() => {}); }, [value]);
  return <div className="flex items-center gap-2">
    {selected ? <Badge variant="secondary" className="max-w-full py-1"><Paperclip /><span className="truncate">{selected.name}</span></Badge> : <span className="text-sm text-muted-foreground">Geen stuk gekoppeld</span>}
    <Button id={id} type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{selected ? "Wijzigen" : "Kiezen of uploaden"}</Button>
    {selected && <Button type="button" size="icon-sm" variant="ghost" onClick={() => { setSelected(null); onChange(""); }}><X /></Button>}
    {open && <PickerDialog suggestedName={suggestedName} onClose={() => setOpen(false)} onPick={(d) => { setSelected(d); onChange(d.id, d); setOpen(false); }} />}
  </div>;
}

export interface PickerOptions { title?: string; description?: string; folderMatch?: RegExp; categories?: string[]; defaultCategory?: string; exclude?: string[] }
/** Herbruikbare kiezer: zoeken in Documenten of nieuw uploaden. Standaard ingesteld voor verantwoordingsstukken; via `options` ook voor andere doeleinden (bv. stukken bij een stemming). */
export function PickerDialog({ onClose, onPick, suggestedName, options = {} }: { onClose: () => void; onPick: (d: Doc) => void; suggestedName?: string; options?: PickerOptions }) {
  const b = useBuilding();
  const [tab, setTab] = useState<"search" | "upload">("search");
  const [q, setQ] = useState(""); const [results, setResults] = useState<Doc[]>([]); const [searching, setSearching] = useState(false);
  const categories = options.categories ?? LEDGER_CATEGORIES;
  const [file, setFile] = useState<File | null>(null); const [category, setCategory] = useState(options.defaultCategory ?? categories[0]); const [description, setDescription] = useState(suggestedName ?? ""); const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => { setSearching(true); try { setResults(await api.get<Doc[]>(`/api/buildings/${b.id}/documents${q ? `?q=${encodeURIComponent(q)}` : ""}`)); } finally { setSearching(false); } }, 250);
    return () => window.clearTimeout(timer.current);
  }, [q]);
  const upload = async () => {
    if (!file) return; setBusy(true);
    try {
      // map "Boekhouding & afrekeningen" (uit de standaardstructuur); valt terug op de hoofdmap
      const folders = await api.get<Folder[]>(`/api/buildings/${b.id}/folders`);
      const folder = folders.find((f) => (options.folderMatch ?? /boekhouding/i).test(f.name));
      const fd = new FormData(); fd.append("file", file); fd.append("category", category); fd.append("visibility", "all"); if (description) fd.append("description", description); if (folder) fd.append("folder_id", folder.id);
      const r = await api.upload<{ id: string }>(`/api/buildings/${b.id}/documents`, fd);
      toast.success(`${file.name} toegevoegd aan Documenten${folder ? ` › ${folder.name}` : ""}`);
      onPick({ id: r.id, name: file.name, folder_id: folder?.id ?? null, category, size: file.size, mime: file.type, visibility: "all", created_at: new Date().toISOString(), version: 1 });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>{options.title ?? "Verantwoordingsstuk"}</DialogTitle><DialogDescription>{options.description ?? "Elke boeking steunt op een gedagtekend stuk (factuur, uittreksel, bon); bewaartermijn 7 jaar. Een nieuwe upload komt ook onder Documenten terecht."}</DialogDescription></DialogHeader>
    <Tabs value={tab} onValueChange={(v) => setTab(v as any)}><TabsList><TabsTrigger value="search"><Search />Zoeken in Documenten</TabsTrigger><TabsTrigger value="upload"><Upload />Nieuw uploaden</TabsTrigger></TabsList></Tabs>
    {tab === "search" && <div className="grid gap-3">
      <div className="relative"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input autoFocus className="pl-8" placeholder="Zoek op naam of omschrijving…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">{searching && !results.length ? <p className="p-4 text-sm text-muted-foreground">Zoeken…</p> : !results.length ? <p className="p-4 text-sm text-muted-foreground">Geen documenten gevonden. Upload een nieuw stuk via het tabblad hiernaast.</p> :
        results.filter((d) => !options.exclude?.includes(d.id)).slice(0, 50).map((d) => <button key={d.id} type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer" onClick={() => onPick(d)}><FileText className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate font-medium">{d.name}</div><div className="truncate text-xs text-muted-foreground">{DOC_CATEGORIES[d.category] ?? d.category} · {fmtSize(d.size)} · {fmtDate(d.created_at)}{d.description ? ` · ${d.description}` : ""}</div></div></button>)}</div>
    </div>}
    {tab === "upload" && <div className="grid gap-3">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition hover:border-primary/60 hover:bg-accent/40" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] ?? null); }}>
        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.xlsx,.xls,.csv,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Upload className="mb-2 size-7 text-muted-foreground" /><div className="text-sm">{file ? <span className="font-medium">{file.name} ({fmtSize(file.size)})</span> : <><span className="font-medium text-primary">Kies een bestand</span> of sleep het hierheen</>}</div><div className="mt-1 text-xs text-muted-foreground">{options.categories ? "PDF, foto of scan" : "PDF, foto of scan van de factuur, uittreksel of bon"}</div></label>
      <div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-sm font-medium">Categorie</label><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{categories.map((k) => <SelectItem key={k} value={k}>{DOC_CATEGORIES[k]}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-1 block text-sm font-medium">Omschrijving</label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={options.categories ? "bv. Offerte dakwerken Peeters" : "bv. Factuur Kone 2026-0442"} /></div></div>
      <div className="flex justify-end"><Button type="button" disabled={!file || busy} onClick={upload}><Upload />{busy ? "Uploaden…" : "Uploaden en koppelen"}</Button></div>
    </div>}
  </DialogContent></Dialog>;
}
