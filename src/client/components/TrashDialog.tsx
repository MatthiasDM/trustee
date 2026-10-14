import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { useBuilding, useFetch } from "./Layout";
import { Empty, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { api, fmtDateTime, fmtSize } from "../lib/api";
import { DOC_CATEGORIES } from "../../shared/types";

/** Prullenbak: verwijderde documenten 30 dagen herstelbaar door de syndicus. */
export function TrashDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const b = useBuilding();
  const { data, loading, reload } = useFetch<any[]>(`/api/buildings/${b.id}/trash`);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>Prullenbak</DialogTitle><DialogDescription>Verwijderde documenten blijven 30 dagen herstelbaar en worden daarna definitief gewist. Verwijderen wordt gelogd.</DialogDescription></DialogHeader>
    {loading || !data ? <Spinner /> : !data.length ? <Empty icon={<Trash2 />} title="De prullenbak is leeg" /> : <ul className="divide-y rounded-lg border text-sm">{data.map((d) => <li key={d.id} className="flex items-center gap-3 px-3 py-2"><div className="min-w-0 flex-1"><div className="truncate font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{DOC_CATEGORIES[d.category] ?? d.category} · {fmtSize(d.size)} · verwijderd {fmtDateTime(d.deleted_at)}{d.deleted_by_name ? ` door ${d.deleted_by_name}` : ""}</div></div><Button size="sm" variant="outline" onClick={async () => { await api.post(`/api/buildings/${b.id}/trash/${d.id}/restore`); toast.success("Document hersteld"); reload(); onRestored(); }}><RotateCcw />Herstellen</Button></li>)}</ul>}
  </DialogContent></Dialog>;
}
