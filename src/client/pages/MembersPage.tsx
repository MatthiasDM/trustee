import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, FileCheck, FileOutput, Gavel, Home, Mail, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { useBuilding, useFetch } from "../components/Layout";
import { MandatesTab } from "../components/MandatesTab";
import { Empty, ErrorBox, Field, PageHeader, RoleBadge, Spinner, UserAvatar } from "../components/ui";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { api, fmtDate } from "../lib/api";
import { ROLE_LABELS, type Member, type Unit, RIGHT_LABELS } from "../../shared/types";
import { useT } from "../lib/i18n";
import { DocumentPicker } from "../ledger/DocumentPicker";
import { TransferDialog } from "../components/TransferDialog";

const NONE = "__none__";
const RoleSelect = ({ value, onChange, size }: { value: string; onChange: (v: string) => void; size?: "sm" | "default" }) => <Select value={value} onValueChange={onChange}><SelectTrigger size={size} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>;

export function MembersPage() {
  const b = useBuilding(); const t = useT();
  const members = useFetch<{ members: Member[]; invites: any[] }>(`/api/buildings/${b.id}/members`);
  const units = useFetch<{ units: Unit[]; total_shares: number; sum_shares: number }>(`/api/buildings/${b.id}/units`);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "members"; const setTab = (t: string) => setSp(t === "members" ? {} : { tab: t });
  const meetingsQ = useFetch<any[]>(`/api/buildings/${b.id}/meetings`);
  const [invite, setInvite] = useState(false); const [unitModal, setUnitModal] = useState<Unit | null | "new">(null); const [transferFor, setTransferFor] = useState<Unit | null>(null);
  const reload = () => { members.reload(); units.reload(); };
  const ok = units.data && units.data.sum_shares === units.data.total_shares;
  return <div>
    <PageHeader title={t("Mede-eigenaars & organen")} subtitle={t("De leden van de VME, hun kavels en quotiteiten, en de mandaten die de algemene vergadering toekent.")} actions={b.isManager && <>{tab === "units" && <Button variant="outline" onClick={() => setUnitModal("new")}><Plus />Kavel</Button>}<Button onClick={() => setInvite(true)}><UserPlus />{t("Uitnodigen")}</Button></>} />
    <Tabs value={tab} onValueChange={setTab} className="mb-4"><TabsList><TabsTrigger value="members"><Users />{t("Leden")} ({members.data?.members.length ?? 0})</TabsTrigger><TabsTrigger value="units"><Home />{t("Kavels")} ({units.data?.units.length ?? 0})</TabsTrigger><TabsTrigger value="mandates"><Gavel />{t("Mandaten")}</TabsTrigger></TabsList></Tabs>
    {tab === "mandates" && <MandatesTab members={members.data?.members ?? []} meetings={meetingsQ.data ?? []} />}
    {tab === "members" && (members.loading ? <Spinner /> : <>
      <div className="divide-y rounded-xl border bg-card shadow-xs">{members.data?.members.map((m) => <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
        <UserAvatar name={m.name} /><div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.name}</div><div className="truncate text-xs text-muted-foreground">{b.isBoard ? `${m.email}${m.phone ? ` · ${m.phone}` : ""} · ` : ""}{m.units ? `Kavel ${m.units}` : "geen kavel"}</div></div>
        {m.role !== "huurder" && (m.ecomm_consent_at ? <Badge variant="success" title={`Akkoord elektronische oproeping (${m.ecomm_consent_via === "written" ? "schriftelijk" : "in de app"}) op ${fmtDate(m.ecomm_consent_at)}`}><Mail />e-oproeping</Badge> : <Badge variant="warning" title="Geen akkoord voor elektronische oproeping: aangetekend versturen">aangetekend</Badge>)}
        {b.isManager && m.role !== "huurder" && !m.ecomm_consent_at && <Button variant="ghost" size="sm" title="Schriftelijk akkoord voor elektronische communicatie registreren" onClick={async () => { const d = prompt(`Datum van het schriftelijk akkoord van ${m.name} voor elektronische oproeping (JJJJ-MM-DD). Bewaar het document zelf onder Documenten.`, new Date().toISOString().slice(0, 10)); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { await api.patch(`/api/buildings/${b.id}/members/${m.user_id}`, { ecomm_consent_at: d }); reload(); toast.success("Akkoord geregistreerd"); } }}><FileCheck />Akkoord</Button>}
        {b.isManager ? <div className="w-56"><RoleSelect size="sm" value={m.role} onChange={async (v) => { await api.patch(`/api/buildings/${b.id}/members/${m.user_id}`, { role: v }); reload(); toast.success("Rol bijgewerkt"); }} /></div> : <RoleBadge role={m.role} />}
        {b.isManager && <Button variant="ghost" size="icon-sm" onClick={async () => { if (confirm(`${m.name} verwijderen uit dit gebouw?`)) { try { await api.del(`/api/buildings/${b.id}/members/${m.user_id}`); reload(); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 /></Button>}
      </div>)}</div>
      {b.isManager && members.data?.invites.length ? <><h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">Openstaande uitnodigingen</h2><div className="divide-y rounded-xl border bg-card shadow-xs">{members.data.invites.map((i) => <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="flex-1 truncate">{i.name ? `${i.name} · ` : ""}{i.email}{i.unit_label ? ` · kavel ${i.unit_label}` : ""}</span><RoleBadge role={i.role} /><span className="text-xs text-muted-foreground">verloopt {fmtDate(i.expires_at)}</span><Button size="sm" variant="ghost" onClick={async () => { await api.del(`/api/buildings/${b.id}/invites/${i.id}`); reload(); }}>Intrekken</Button></div>)}</div></> : null}
    </>)}
    {tab === "units" && (units.loading || !units.data ? <Spinner /> : <>
      <div className={`mb-3 flex items-center gap-2 text-sm ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}Som quotiteiten: {units.data.sum_shares} / {units.data.total_shares}{!ok && " — komt niet overeen met het totaal van het gebouw"}</div>
      {units.data.units.length ? <div className="rounded-xl border bg-card shadow-xs"><Table><TableHeader><TableRow><TableHead>Kavel</TableHead><TableHead>Type</TableHead><TableHead>Verdieping</TableHead><TableHead className="text-right">Aandelen</TableHead><TableHead>Eigenaar(s)</TableHead>{b.isManager && <TableHead />}</TableRow></TableHeader>
        <TableBody>{units.data.units.map((u) => <TableRow key={u.id}><TableCell className="font-medium">{u.label}</TableCell><TableCell className="capitalize">{u.type}</TableCell><TableCell>{u.floor}</TableCell><TableCell className="text-right tabular-nums">{u.shares}</TableCell><TableCell>{u.owners?.map((o) => `${o.name}${o.right_type && o.right_type !== "vol" ? ` (${RIGHT_LABELS[o.right_type]})` : o.share_pct < 100 ? ` (${o.share_pct}%)` : ""}`).join(", ") || <span className="text-muted-foreground">—</span>}{u.split && <div className="mt-0.5">{u.suspended ? <Badge variant="warning" title="Gesplitste eigendom zonder lasthebber: deelnamerecht geschorst (art. 3.87 §1, lid 2 BW)">geen lasthebber: stemrecht geschorst</Badge> : <Badge variant="secondary">lasthebber: {u.voter_name}</Badge>}</div>}</TableCell>{b.isManager && <TableCell className="text-right whitespace-nowrap"><Button variant="ghost" size="sm" title="Overdrachtsdossier bij verkoop (art. 3.94)" onClick={async () => { const r = await api.post<any>(`/api/buildings/${b.id}/ledger/units/${u.id}/transfer-dossier`); toast.success("Overdrachtsdossier als PDF bewaard onder Documenten"); window.open(`/api/buildings/${b.id}/documents/${r.documentId}/download`, "_blank"); }}><FileOutput />Overdracht</Button>{!!u.owners?.length && <Button variant="ghost" size="sm" title="Verkoop afrekenen en eigenaar wisselen (art. 3.94 §5)" onClick={() => setTransferFor(u)}><ArrowRightLeft />Verkoop</Button>}<Button variant="ghost" size="icon-sm" onClick={() => setUnitModal(u)}><Pencil /></Button></TableCell>}</TableRow>)}</TableBody></Table></div>
        : <Empty icon={<Home />} title="Nog geen kavels" hint="Voeg appartementen, garages en bergingen toe met hun quotiteiten." />}
    </>)}
    {invite && <InviteModal units={units.data?.units ?? []} onClose={() => setInvite(false)} onDone={(n) => { setInvite(false); reload(); toast.success(`${n} uitnodiging(en) verstuurd`); }} />}
    {transferFor && <TransferDialog unit={transferFor} members={members.data?.members ?? []} onClose={() => setTransferFor(null)} onDone={() => { setTransferFor(null); reload(); }} />}
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
  const [owners, setOwners] = useState<{ user_id: string; share_pct: number; right_type: string }[]>(unit?.owners?.map((o) => ({ user_id: o.user_id, share_pct: o.share_pct, right_type: o.right_type ?? "vol" })) ?? []);
  const [rep, setRep] = useState<{ user_id: string; document_id: string }>({ user_id: unit?.representative_user_id ?? "", document_id: unit?.representative_document_id ?? "" });
  const split = owners.filter((o) => o.user_id).length > 1 || owners.some((o) => o.user_id && o.right_type !== "vol");
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      let id = unit?.id;
      if (unit) await api.patch(`/api/buildings/${b.id}/units/${unit.id}`, { ...f, shares: Number(f.shares), floor: f.floor || null });
      else id = (await api.post<{ ids: string[] }>(`/api/buildings/${b.id}/units`, { ...f, shares: Number(f.shares), floor: f.floor || null })).ids[0];
      await api.put(`/api/buildings/${b.id}/units/${id}/owners`, { owners: owners.filter((o) => o.user_id) });
      if (split || unit?.representative_user_id) await api.put(`/api/buildings/${b.id}/units/${id}/representative`, { user_id: split ? rep.user_id || null : null, document_id: rep.document_id || null });
      onDone();
    } catch (err) { setError(err); }
  };
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>{unit ? `Kavel ${unit.label}` : "Nieuwe kavel"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-3"><Field label="Label"><Input required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="A1" /></Field><Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["appartement", "garage", "berging", "handel", "ander"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Verdieping"><Input value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} /></Field><Field label="Aandelen (quotiteit)"><Input type="number" min={0} value={f.shares} onChange={(e) => setF({ ...f, shares: +e.target.value })} /></Field></div>
      <Field label="Eigenaar(s)"><div className="grid gap-2">{owners.map((o, i) => <div key={i} className="flex gap-2"><Select value={o.user_id || NONE} onValueChange={(v) => setOwners(owners.map((x, j) => j === i ? { ...x, user_id: v === NONE ? "" : v } : x))}><SelectTrigger className="flex-1"><SelectValue placeholder="kies lid" /></SelectTrigger><SelectContent><SelectItem value={NONE}>— kies lid —</SelectItem>{members.filter((m) => m.role !== "huurder").map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select><Input className="w-20" type="number" min={0} max={100} value={o.share_pct} onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, share_pct: +e.target.value } : x))} /><span className="self-center text-sm text-muted-foreground">%</span><Select value={o.right_type} onValueChange={(v) => setOwners(owners.map((x, j) => j === i ? { ...x, right_type: v } : x))}><SelectTrigger className="w-40" aria-label="Recht"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RIGHT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select><Button type="button" variant="ghost" size="icon" onClick={() => setOwners(owners.filter((_, j) => j !== i))}><X /></Button></div>)}<Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOwners([...owners, { user_id: "", share_pct: 100, right_type: "vol" }])}><Plus />Eigenaar</Button></div></Field>
      {split && <div className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
        <p className="text-xs text-amber-900 dark:text-amber-200">Gesplitste eigendom (onverdeeldheid, vruchtgebruik, erfpacht, opstal of gebruik). Het deelnamerecht van deze kavel is geschorst tot de belanghebbenden schriftelijk één lasthebber aanwijzen (art. 3.87 §1, lid 2 BW). Die wordt opgeroepen, ontvangt de stukken en stemt voor de hele kavel.</p>
        <Field label="Lasthebber"><Select value={rep.user_id || NONE} onValueChange={(v) => setRep({ ...rep, user_id: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>— nog niet aangewezen (geschorst) —</SelectItem>{members.filter((m) => m.role !== "syndicus" && m.role !== "huurder").map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select></Field>
        {rep.user_id && <Field label="Schriftelijke mededeling (optioneel)"><DocumentPicker value={rep.document_id} onChange={(id) => setRep({ ...rep, document_id: id })} suggestedName="Aanwijzing lasthebber" /></Field>}
      </div>}
      <ErrorBox error={error} />
      <DialogFooter className="sm:justify-between">{unit ? <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={async () => { if (confirm("Kavel verwijderen?")) { await api.del(`/api/buildings/${b.id}/units/${unit.id}`); onDone(); } }}>Verwijderen</Button> : <span />}<Button>Opslaan</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
