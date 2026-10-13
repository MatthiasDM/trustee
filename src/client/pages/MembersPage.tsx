import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Home, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, PageHeader, RoleBadge, Spinner, UserAvatar } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { api, fmtDate } from "../lib/api";
import { ROLE_LABELS, type Member, type Unit } from "../../shared/types";

const NONE = "__none__";
const RoleSelect = ({ value, onChange, size }: { value: string; onChange: (v: string) => void; size?: "sm" | "default" }) => <Select value={value} onValueChange={onChange}><SelectTrigger size={size} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>;

export function MembersPage() {
  const b = useBuilding();
  const members = useFetch<{ members: Member[]; invites: any[] }>(`/api/buildings/${b.id}/members`);
  const units = useFetch<{ units: Unit[]; total_shares: number; sum_shares: number }>(`/api/buildings/${b.id}/units`);
  const [tab, setTab] = useState("members");
  const [invite, setInvite] = useState(false); const [unitModal, setUnitModal] = useState<Unit | null | "new">(null);
  const reload = () => { members.reload(); units.reload(); };
  const ok = units.data && units.data.sum_shares === units.data.total_shares;
  return <div>
    <PageHeader title="Leden & kavels" subtitle="Mede-eigenaars, raad van mede-eigendom, huurders en de verdeling van quotiteiten." actions={b.isManager && <>{tab === "units" && <Button variant="outline" onClick={() => setUnitModal("new")}><Plus />Kavel</Button>}<Button onClick={() => setInvite(true)}><UserPlus />Uitnodigen</Button></>} />
    <Tabs value={tab} onValueChange={setTab} className="mb-4"><TabsList><TabsTrigger value="members"><Users />Leden ({members.data?.members.length ?? 0})</TabsTrigger><TabsTrigger value="units"><Home />Kavels ({units.data?.units.length ?? 0})</TabsTrigger></TabsList></Tabs>
    {tab === "members" && (members.loading ? <Spinner /> : <>
      <div className="divide-y rounded-xl border bg-card shadow-xs">{members.data?.members.map((m) => <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
        <UserAvatar name={m.name} /><div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.name}</div><div className="truncate text-xs text-muted-foreground">{b.isBoard ? `${m.email}${m.phone ? ` · ${m.phone}` : ""} · ` : ""}{m.units ? `Kavel ${m.units}` : "geen kavel"}</div></div>
        {b.isManager ? <div className="w-56"><RoleSelect size="sm" value={m.role} onChange={async (v) => { await api.patch(`/api/buildings/${b.id}/members/${m.user_id}`, { role: v }); reload(); toast.success("Rol bijgewerkt"); }} /></div> : <RoleBadge role={m.role} />}
        {b.isManager && <Button variant="ghost" size="icon-sm" onClick={async () => { if (confirm(`${m.name} verwijderen uit dit gebouw?`)) { try { await api.del(`/api/buildings/${b.id}/members/${m.user_id}`); reload(); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 /></Button>}
      </div>)}</div>
      {b.isManager && members.data?.invites.length ? <><h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">Openstaande uitnodigingen</h2><div className="divide-y rounded-xl border bg-card shadow-xs">{members.data.invites.map((i) => <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="flex-1 truncate">{i.name ? `${i.name} · ` : ""}{i.email}{i.unit_label ? ` · kavel ${i.unit_label}` : ""}</span><RoleBadge role={i.role} /><span className="text-xs text-muted-foreground">verloopt {fmtDate(i.expires_at)}</span><Button size="sm" variant="ghost" onClick={async () => { await api.del(`/api/buildings/${b.id}/invites/${i.id}`); reload(); }}>Intrekken</Button></div>)}</div></> : null}
    </>)}
    {tab === "units" && (units.loading || !units.data ? <Spinner /> : <>
      <div className={`mb-3 flex items-center gap-2 text-sm ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}Som quotiteiten: {units.data.sum_shares} / {units.data.total_shares}{!ok && " — komt niet overeen met het totaal van het gebouw"}</div>
      {units.data.units.length ? <div className="rounded-xl border bg-card shadow-xs"><Table><TableHeader><TableRow><TableHead>Kavel</TableHead><TableHead>Type</TableHead><TableHead>Verdieping</TableHead><TableHead className="text-right">Aandelen</TableHead><TableHead>Eigenaar(s)</TableHead>{b.isManager && <TableHead />}</TableRow></TableHeader>
        <TableBody>{units.data.units.map((u) => <TableRow key={u.id}><TableCell className="font-medium">{u.label}</TableCell><TableCell className="capitalize">{u.type}</TableCell><TableCell>{u.floor}</TableCell><TableCell className="text-right tabular-nums">{u.shares}</TableCell><TableCell>{u.owners?.map((o) => `${o.name}${o.share_pct < 100 ? ` (${o.share_pct}%)` : ""}`).join(", ") || <span className="text-muted-foreground">—</span>}</TableCell>{b.isManager && <TableCell className="text-right"><Button variant="ghost" size="icon-sm" onClick={() => setUnitModal(u)}><Pencil /></Button></TableCell>}</TableRow>)}</TableBody></Table></div>
        : <Empty icon={<Home />} title="Nog geen kavels" hint="Voeg appartementen, garages en bergingen toe met hun quotiteiten." />}
    </>)}
    {invite && <InviteModal units={units.data?.units ?? []} onClose={() => setInvite(false)} onDone={(n) => { setInvite(false); reload(); toast.success(`${n} uitnodiging(en) verstuurd`); }} />}
    {unitModal && <UnitModal unit={unitModal === "new" ? null : unitModal} members={members.data?.members ?? []} onClose={() => setUnitModal(null)} onDone={() => { setUnitModal(null); reload(); }} />}
  </div>;
}

function InviteModal({ units, onClose, onDone }: { units: Unit[]; onClose: () => void; onDone: (n: number) => void }) {
  const b = useBuilding();
  const [rows, setRows] = useState([{ email: "", name: "", role: "eigenaar", unit_id: "" }]);
  const [bulk, setBulk] = useState(""); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const upd = (i: number, patch: Partial<typeof rows[0]>) => setRows(rows.map((x, j) => j === i ? { ...x, ...patch } : x));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const list = [...rows.filter((r) => r.email), ...bulk.split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [email, name, role, unit] = l.split(/[;,\t]/).map((s) => s?.trim()); return { email, name: name || "", role: role || "eigenaar", unit_id: units.find((u) => u.label === unit)?.id ?? "" }; })];
    try { const r = await api.post<{ created: number }>(`/api/buildings/${b.id}/invites`, { invites: list.map((r) => ({ ...r, unit_id: r.unit_id || null, name: r.name || undefined })) }); onDone(r.created); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Leden uitnodigen</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">{rows.map((r, i) => <div key={i} className="grid grid-cols-12 gap-2"><Input className="col-span-4" type="email" placeholder="e-mail" value={r.email} onChange={(e) => upd(i, { email: e.target.value })} /><Input className="col-span-3" placeholder="naam" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /><div className="col-span-3"><RoleSelect value={r.role} onChange={(v) => upd(i, { role: v })} /></div><div className="col-span-2"><Select value={r.unit_id || NONE} onValueChange={(v) => upd(i, { unit_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue placeholder="kavel" /></SelectTrigger><SelectContent><SelectItem value={NONE}>— kavel —</SelectItem>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}</SelectContent></Select></div></div>)}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setRows([...rows, { email: "", name: "", role: "eigenaar", unit_id: "" }])}><Plus />Rij</Button></div>
      <details><summary className="cursor-pointer text-sm text-primary">Bulk invoer (CSV)</summary><Textarea className="mt-2 font-mono text-xs" placeholder={"email;naam;rol;kavel\njan@voorbeeld.be;Jan Peeters;eigenaar;A1"} value={bulk} onChange={(e) => setBulk(e.target.value)} /></details>
      <ErrorBox error={error} />
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Annuleren</Button><Button disabled={busy}>Uitnodigingen versturen</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function UnitModal({ unit, members, onClose, onDone }: { unit: Unit | null; members: Member[]; onClose: () => void; onDone: () => void }) {
  const b = useBuilding();
  const [f, setF] = useState({ label: unit?.label ?? "", type: unit?.type ?? "appartement", floor: unit?.floor ?? "", shares: unit?.shares ?? 0 });
  const [owners, setOwners] = useState<{ user_id: string; share_pct: number }[]>(unit?.owners?.map((o) => ({ user_id: o.user_id, share_pct: o.share_pct })) ?? []);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      let id = unit?.id;
      if (unit) await api.patch(`/api/buildings/${b.id}/units/${unit.id}`, { ...f, shares: Number(f.shares), floor: f.floor || null });
      else id = (await api.post<{ ids: string[] }>(`/api/buildings/${b.id}/units`, { ...f, shares: Number(f.shares), floor: f.floor || null })).ids[0];
      await api.put(`/api/buildings/${b.id}/units/${id}/owners`, { owners: owners.filter((o) => o.user_id) });
      onDone();
    } catch (err) { setError(err); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>{unit ? `Kavel ${unit.label}` : "Nieuwe kavel"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-3"><Field label="Label"><Input required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="A1" /></Field><Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["appartement", "garage", "berging", "handel", "ander"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Verdieping"><Input value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} /></Field><Field label="Aandelen (quotiteit)"><Input type="number" min={0} value={f.shares} onChange={(e) => setF({ ...f, shares: +e.target.value })} /></Field></div>
      <Field label="Eigenaar(s)"><div className="grid gap-2">{owners.map((o, i) => <div key={i} className="flex gap-2"><Select value={o.user_id || NONE} onValueChange={(v) => setOwners(owners.map((x, j) => j === i ? { ...x, user_id: v === NONE ? "" : v } : x))}><SelectTrigger className="flex-1"><SelectValue placeholder="kies lid" /></SelectTrigger><SelectContent><SelectItem value={NONE}>— kies lid —</SelectItem>{members.filter((m) => m.role !== "huurder").map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select><Input className="w-20" type="number" min={0} max={100} value={o.share_pct} onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, share_pct: +e.target.value } : x))} /><span className="self-center text-sm text-muted-foreground">%</span><Button type="button" variant="ghost" size="icon" onClick={() => setOwners(owners.filter((_, j) => j !== i))}><X /></Button></div>)}<Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOwners([...owners, { user_id: "", share_pct: 100 }])}><Plus />Eigenaar</Button></div></Field>
      <ErrorBox error={error} />
      <DialogFooter className="sm:justify-between">{unit ? <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={async () => { if (confirm("Kavel verwijderen?")) { await api.del(`/api/buildings/${b.id}/units/${unit.id}`); onDone(); } }}>Verwijderen</Button> : <span />}<Button>Opslaan</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
