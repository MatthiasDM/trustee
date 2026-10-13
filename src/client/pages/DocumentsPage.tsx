import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, ClipboardCheck, Download, Eye, File, FileImage, FileSpreadsheet, FileText, Folder, FolderPlus, Lock, MoreHorizontal, Pencil, Search, Trash2, Upload, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { DocCommentsDialog } from "../components/DocComments";
import { ComplianceTab } from "../components/ComplianceTab";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ShieldCheck } from "lucide-react";
import { Empty, ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { api, fmtDate, fmtSize } from "../lib/api";
import { DOC_CATEGORIES, type Doc, type Folder as FolderT } from "../../shared/types";
import { useT } from "../lib/i18n";

const VIS: Record<string, string> = { all: "Iedereen", owners_only: "Enkel eigenaars", raad: "Raad + syndicus", syndicus: "Enkel syndicus" };
const ROOT = "__root__";
const canPreview = (d: Doc) => /^(application\/pdf|image\/|text\/html)/.test(d.mime) || /\.(pdf|png|jpe?g|gif|webp|html)$/i.test(d.name);
const FileIcon = ({ mime }: { mime: string }) => { const I = mime.includes("pdf") ? FileText : mime.startsWith("image/") ? FileImage : mime.includes("sheet") || mime.includes("excel") || mime.includes("csv") ? FileSpreadsheet : File; return <I className="size-5 text-muted-foreground" />; };

export function DocumentsPage() {
  const b = useBuilding(); const t = useT();
  const [sp, setSp] = useSearchParams();
  const folderId = sp.get("folder") ?? "root";
  const view = sp.get("tab") === "compliance" ? "compliance" : "docs";
  const [q, setQ] = useState("");
  const folders = useFetch<FolderT[]>(`/api/buildings/${b.id}/folders`);
  const docs = useFetch<Doc[]>(`/api/buildings/${b.id}/documents?${q ? `q=${encodeURIComponent(q)}` : `folder=${folderId}`}`);
  const [upload, setUpload] = useState(false); const [newFolder, setNewFolder] = useState(false); const [edit, setEdit] = useState<Doc | null>(null); const [review, setReview] = useState<Doc | null>(null); const [preview, setPreview] = useState<Doc | null>(null);
  const current = folders.data?.find((f) => f.id === folderId);
  const children = useMemo(() => (folders.data ?? []).filter((f) => (f.parent_id ?? "root") === folderId), [folders.data, folderId]);
  const crumbs = useMemo(() => { const out: FolderT[] = []; let f = current; while (f) { out.unshift(f); f = folders.data?.find((x) => x.id === f!.parent_id); } return out; }, [current, folders.data]);
  const go = (id: string) => { setQ(""); setSp(id === "root" ? {} : { folder: id }); };
  const del = async (d: Doc) => { if (!confirm(`"${d.name}" verwijderen?`)) return; await api.del(`/api/buildings/${b.id}/documents/${d.id}`); docs.reload(); toast.success("Document verwijderd"); };
  const delFolder = async (f: FolderT) => { if (!confirm(`Map "${f.name}" verwijderen?`)) return; try { await api.del(`/api/buildings/${b.id}/folders/${f.id}`); folders.reload(); } catch (e) { toast.error((e as Error).message); } };

  return <div>
    <PageHeader title={t("Documenten")} subtitle={b.role === "commissaris" ? "Je hebt inzage in alle stukken en kan opmerkingen en bevindingen noteren (art. 3.91 BW). Bij stukken \"enkel syndicus\" wordt de syndicus automatisch van je inzage verwittigd." : b.role === "raad" ? "De raad heeft inzage- en kopierecht in alle beheersdocumenten (art. 3.90 BW). Open je een stuk \"enkel syndicus\", dan geldt dat als kennisgeving: de syndicus krijgt automatisch een melding." : t("Statuten, verslagen, afrekeningen, offertes en meer.")} actions={<>{b.isBoard && <Button variant="outline" onClick={() => setNewFolder(true)}><FolderPlus />{t("Map")}</Button>}{b.isOwner && <Button onClick={() => setUpload(true)}><Upload />{t("Uploaden")}</Button>}</>} />
    <Tabs value={view} onValueChange={(v) => setSp(v === "compliance" ? { tab: "compliance" } : {})} className="mb-4"><TabsList><TabsTrigger value="docs"><Folder />{t("Documenten")}</TabsTrigger><TabsTrigger value="compliance"><ShieldCheck />Keuringen & attesten</TabsTrigger></TabsList></Tabs>
    {view === "compliance" ? <ComplianceTab /> : <>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm"><button className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent cursor-pointer" onClick={() => go("root")}><Folder className="size-4 text-muted-foreground" />{t("Alle documenten")}</button>{crumbs.map((f) => <span key={f.id} className="flex items-center gap-1"><ChevronRight className="size-4 text-muted-foreground" /><button className="rounded-md px-1.5 py-1 hover:bg-accent cursor-pointer" onClick={() => go(f.id)}>{f.name}</button></span>)}</nav>
      <div className="relative w-full sm:w-72"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder={t("Zoeken in alle documenten…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
    </div>
    {folders.loading || docs.loading ? <Spinner /> : !children.length && !docs.data?.length ? <Empty icon={<Folder />} title={q ? t("Geen resultaten") : t("Deze map is leeg")} hint={q ? undefined : "Upload documenten of maak een submap aan."} /> :
    <div className="divide-y rounded-xl border bg-card shadow-xs">
      {!q && children.map((f) => <div key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"><button className="flex flex-1 items-center gap-3 text-left cursor-pointer" onClick={() => go(f.id)}><Folder className="size-5 fill-primary/15 text-primary" /><span className="text-sm font-medium">{f.name}</span>{f.visibility !== "all" && <Badge variant="secondary"><Lock />{VIS[f.visibility]}</Badge>}</button>{b.isManager && <Button variant="ghost" size="icon-sm" onClick={() => delFolder(f)}><Trash2 /></Button>}</div>)}
      {(docs.data ?? []).map((d) => <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
        <FileIcon mime={d.mime} />
        <div className="min-w-0 flex-1">{canPreview(d) ? <button className="block w-full truncate text-left text-sm font-medium hover:text-primary cursor-pointer" onClick={() => setPreview(d)}>{d.name}</button> : <a href={`/api/buildings/${b.id}/documents/${d.id}/download`} className="block truncate text-sm font-medium hover:text-primary">{d.name}</a>}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{DOC_CATEGORIES[d.category] ?? d.category}</span><span>·</span><span>{fmtSize(d.size)}</span><span>·</span><span>{fmtDate(d.created_at)}</span><span>·</span><span>{d.uploaded_by_name}</span>{d.version > 1 && <Badge variant="outline">v{d.version}</Badge>}{d.visibility !== "all" && <Badge variant="secondary"><Lock />{VIS[d.visibility]}</Badge>}{(d as any).unit_label && <Badge variant="info">Kavel {(d as any).unit_label}</Badge>}</div>
          {d.description && <div className="mt-0.5 text-xs text-muted-foreground">{d.description}</div>}</div>
        {canPreview(d) && <Button variant="ghost" size="icon-sm" title="Voorvertoning" onClick={() => setPreview(d)}><Eye /></Button>}
        <Button variant="ghost" size="icon-sm" asChild><a href={`/api/buildings/${b.id}/documents/${d.id}/download`} aria-label="Downloaden"><Download /></a></Button>
        {b.isBoard && <Button variant="ghost" size="icon-sm" title="Controle / opmerkingen" onClick={() => setReview(d)}><ClipboardCheck /></Button>}
        {(b.isManager || b.role === "raad") && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Acties"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEdit(d)}><Pencil />Bewerken</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => del(d)}><Trash2 />Verwijderen</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
      </div>)}
    </div>}
    </>}
    <UploadModal open={upload} onClose={() => setUpload(false)} folders={folders.data ?? []} folderId={folderId} onDone={() => { setUpload(false); docs.reload(); toast.success("Document geüpload"); }} canSetVisibility={b.isBoard} />
    <Dialog open={newFolder} onOpenChange={setNewFolder}><DialogContent><DialogHeader><DialogTitle>Nieuwe map</DialogTitle></DialogHeader><FolderForm parentId={folderId === "root" ? null : folderId} onDone={() => { setNewFolder(false); folders.reload(); }} /></DialogContent></Dialog>
    <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle className="truncate pr-8">{preview?.name}</DialogTitle></DialogHeader>{preview && (preview.mime.startsWith("image/") ? <img src={`/api/buildings/${b.id}/documents/${preview.id}/download?inline=1`} alt={preview.name} className="max-h-[75vh] w-full rounded-lg object-contain" /> : <iframe title={preview.name} src={`/api/buildings/${b.id}/documents/${preview.id}/download?inline=1`} className="h-[75vh] w-full rounded-lg border" sandbox="" />)}<div className="flex justify-end"><Button variant="outline" size="sm" asChild><a href={`/api/buildings/${b.id}/documents/${preview?.id}/download`}><Download />Downloaden</a></Button></div></DialogContent></Dialog>
    {review && <DocCommentsDialog doc={review} onClose={() => setReview(null)} />}
    <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}><DialogContent><DialogHeader><DialogTitle>Document bewerken</DialogTitle></DialogHeader>{edit && <EditDocForm doc={edit} folders={folders.data ?? []} onDone={() => { setEdit(null); docs.reload(); }} />}</DialogContent></Dialog>
  </div>;
}

function FolderSelect({ value, onChange, folders }: { value: string; onChange: (v: string) => void; folders: FolderT[] }) {
  return <Select value={value || ROOT} onValueChange={(v) => onChange(v === ROOT ? "" : v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ROOT}>(hoofdmap)</SelectItem>{folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select>;
}
function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(DOC_CATEGORIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>;
}
function VisSelect({ value, onChange, options = VIS }: { value: string; onChange: (v: string) => void; options?: Record<string, string> }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(options).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>;
}

export function UploadModal({ open, onClose, folders, folderId, onDone, canSetVisibility }: { open: boolean; onClose: () => void; folders: FolderT[]; folderId: string; onDone: () => void; canSetVisibility: boolean }) {
  const b = useBuilding();
  const [files, setFiles] = useState<File[]>([]);
  const [meta, setMeta] = useState({ folder_id: folderId === "root" ? "" : folderId, category: "overig", visibility: "all", description: "", notify: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [progress, setProgress] = useState(0);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!files.length) return; setBusy(true); setError(null);
    try {
      for (let i = 0; i < files.length; i++) { const fd = new FormData(); fd.append("file", files[i]); Object.entries(meta).forEach(([k, v]) => fd.append(k, String(v))); await api.upload(`/api/buildings/${b.id}/documents`, fd); setProgress(i + 1); }
      setFiles([]); onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Document(en) uploaden</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition hover:border-primary/60 hover:bg-accent/40" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles([...files, ...e.dataTransfer.files]); }}>
        <input type="file" multiple className="hidden" onChange={(e) => setFiles([...files, ...(e.target.files ?? [])])} />
        <UploadCloud className="mb-2 size-8 text-muted-foreground" />
        <div className="text-sm">{files.length ? <span className="font-medium">{files.map((f) => f.name).join(", ")}</span> : <><span className="font-medium text-primary">Kies bestanden</span> of sleep ze hierheen</>}</div><div className="mt-1 text-xs text-muted-foreground">Max 50 MB per bestand</div>
      </label>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Map"><FolderSelect value={meta.folder_id} onChange={(v) => setMeta({ ...meta, folder_id: v })} folders={folders} /></Field><Field label="Categorie"><CategorySelect value={meta.category} onChange={(v) => setMeta({ ...meta, category: v })} /></Field></div>
      {canSetVisibility && <Field label="Zichtbaar voor"><VisSelect value={meta.visibility} onChange={(v) => setMeta({ ...meta, visibility: v })} /></Field>}
      <Field label="Omschrijving (optioneel)"><Input value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
      {canSetVisibility && <label className="flex items-center gap-2 text-sm"><Checkbox checked={meta.notify} onCheckedChange={(v) => setMeta({ ...meta, notify: !!v })} />Leden verwittigen (push + e-mail)</label>}
      <ErrorBox error={error} />
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={busy || !files.length}>{busy ? `Uploaden… ${progress}/${files.length}` : "Uploaden"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function FolderForm({ parentId, onDone }: { parentId: string | null; onDone: () => void }) {
  const b = useBuilding();
  const [name, setName] = useState(""); const [visibility, setVisibility] = useState("all"); const [error, setError] = useState<unknown>(null);
  return <form onSubmit={async (e) => { e.preventDefault(); try { await api.post(`/api/buildings/${b.id}/folders`, { name, parent_id: parentId, visibility }); onDone(); } catch (err) { setError(err); } }} className="grid gap-4">
    <Field label="Naam"><Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Zichtbaar voor"><VisSelect value={visibility} onChange={setVisibility} options={{ all: "Iedereen", raad: "Raad + syndicus", syndicus: "Enkel syndicus" }} /></Field>
    <ErrorBox error={error} /><DialogFooter><Button>Aanmaken</Button></DialogFooter>
  </form>;
}

function EditDocForm({ doc, folders, onDone }: { doc: Doc; folders: FolderT[]; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ name: doc.name, description: doc.description ?? "", category: doc.category, folder_id: doc.folder_id ?? "", visibility: doc.visibility as string });
  const [file, setFile] = useState<File | null>(null); const [error, setError] = useState<unknown>(null);
  return <form onSubmit={async (e) => { e.preventDefault(); try { await api.patch(`/api/buildings/${b.id}/documents/${doc.id}`, { ...f, folder_id: f.folder_id || null }); if (file) { const fd = new FormData(); fd.append("file", file); await api.upload(`/api/buildings/${b.id}/documents/${doc.id}/version`, fd); } onDone(); } catch (err) { setError(err); } }} className="grid gap-4">
    <Field label="Naam"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Omschrijving"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Map"><FolderSelect value={f.folder_id} onChange={(v) => setF({ ...f, folder_id: v })} folders={folders} /></Field><Field label="Categorie"><CategorySelect value={f.category} onChange={(v) => setF({ ...f, category: v })} /></Field></div>
    <Field label="Zichtbaar voor"><VisSelect value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} /></Field>
    <Field label={`Nieuwe versie uploaden (huidige: v${doc.version})`}><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
    <ErrorBox error={error} /><DialogFooter><Button>Opslaan</Button></DialogFooter>
  </form>;
}
