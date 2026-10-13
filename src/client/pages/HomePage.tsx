import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, MapPin, Plus } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Empty, ErrorBox, Field, PageHeader, RoleBadge } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export function HomePage() {
  const { buildings, orgs, user, refresh } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", address: "", postal_code: "", city: "", enterprise_number: "", total_shares: 1000, org_id: orgs[0]?.id ?? "new" });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api.post<{ id: string }>("/api/buildings", { ...f, org_id: f.org_id === "new" ? undefined : f.org_id, total_shares: Number(f.total_shares) }); await refresh(); nav(`/b/${r.id}`); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <div>
    <PageHeader title={`Welkom, ${user?.name.split(" ")[0]}`} subtitle="Kies een gebouw (VME) om verder te gaan." actions={<Button onClick={() => setOpen(true)}><Plus />Nieuw gebouw</Button>} />
    {buildings.length === 0 ? <Empty icon={<Building2 />} title="Je bent nog geen lid van een gebouw" hint={orgs.length ? "Maak je eerste VME aan om te starten." : "Wacht op een uitnodiging van je syndicus, of maak zelf een gebouw aan (zelfbeheer)."} action={<Button onClick={() => setOpen(true)}><Plus />Gebouw aanmaken</Button>} /> :
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{buildings.map((b) => <Link key={b.id} to={`/b/${b.id}`} className="group rounded-xl border bg-card p-5 shadow-xs transition hover:border-primary/50 hover:shadow-md">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="size-5" /></div>
        <div className="font-semibold group-hover:text-primary">{b.name}</div><div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" />{b.address}{b.city ? `, ${b.city}` : ""}</div>
        <div className="mt-4 flex items-center justify-between"><RoleBadge role={b.role} /><span className="text-xs text-muted-foreground">{b.org_name}</span></div></Link>)}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Nieuw gebouw (VME)</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        {orgs.length > 0 && <Field label="Organisatie"><Select value={f.org_id} onValueChange={(v) => setF({ ...f, org_id: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}<SelectItem value="new">Nieuwe organisatie (zelfbeheer)</SelectItem></SelectContent></Select></Field>}
        <Field label="Naam gebouw / residentie"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Residentie Zeezicht" /></Field>
        <Field label="Adres"><Input required value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Zeedijk 12" /></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="Postcode"><Input value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} /></Field><Field label="Gemeente" className="col-span-2"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Ondernemingsnr. VME"><Input value={f.enterprise_number} onChange={(e) => setF({ ...f, enterprise_number: e.target.value })} placeholder="0xxx.xxx.xxx" /></Field><Field label="Totaal aandelen"><Input type="number" min={1} value={f.total_shares} onChange={(e) => setF({ ...f, total_shares: +e.target.value })} /></Field></div>
        <ErrorBox error={error} />
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuleren</Button><Button disabled={busy}>Aanmaken</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </div>;
}
