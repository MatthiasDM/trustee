import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Banknote, Building2, ChevronRight, Home, Landmark, PiggyBank, Plus, Trash2, UserPlus, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "../components/Layout";
import { Empty, ErrorBox, Field, PageHeader, Spinner, Stat } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, fmtDateTime } from "../lib/api";
import { useAuth } from "../lib/auth";
import { eur } from "../ledger/shared";
import { useT } from "../lib/i18n";

const SEV: Record<string, any> = { high: "red", medium: "warning", low: "secondary" };
const ACTION_TEXT: Record<string, string> = { incident: "{n} dringende melding(en)", overdue: "{n} kavel(s) met vervallen voorschotten ({amount})", minutes: "Notulen van een recente AV nog niet definitief (30 dagen)", close: "Boekjaar verstreken, nog niet afgesloten", commissaris: "Geen commissaris van de rekeningen voor dit jaar", mandate: "{n} mandaat/mandaten lopen binnen 90 dagen af", bank: "{n} bankverrichting(en) te verwerken", agenda: "{n} agendapunt(en) voorgesteld door eigenaars", question: "{n} onbeantwoorde vraag/vragen" };

/** Kantoorportaal: alle gebouwen van het syndicuskantoor, actiepunten en medewerkers. */
export function OrgPage() {
  const { orgId } = useParams(); const { user } = useAuth(); const t = useT();
  const { data, loading, reload } = useFetch<any>(`/api/orgs/${orgId}/overview`);
  const [invite, setInvite] = useState(false); const [email, setEmail] = useState(""); const [role, setRole] = useState("staff"); const [error, setError] = useState<unknown>(null);
  if (loading || !data) return <Spinner />;
  const isAdmin = ["owner", "admin"].includes(data.org.role);
  return <div>
    <PageHeader title={data.org.name} subtitle={t("Kantoorportaal: alle gebouwen die je beheert, met wat vandaag aandacht vraagt.")} actions={<Button asChild><Link to="/"><Plus />{t("Nieuw gebouw")}</Link></Button>} />
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Stat label={t("Gebouwen")} value={data.totals.buildings} icon={<Building2 />} /><Stat label={t("Kavels")} value={data.totals.units} icon={<Home />} /><Stat label={t("Leden")} value={data.totals.members} icon={<Users />} />
      <Stat label={t("Open meldingen")} value={data.totals.open_incidents} icon={<Wrench />} /><Stat label={t("Werkkapitaal totaal")} value={eur(data.totals.working_cash)} icon={<Banknote />} /><Stat label={t("Reservekapitaal totaal")} value={eur(data.totals.reserve_cash)} icon={<PiggyBank />} />
    </div>
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <section><h2 className="mb-2 font-semibold">{t("Gebouwen")}</h2>
          {!data.buildings.length ? <Empty icon={<Building2 />} title={t("Nog geen gebouwen")} /> : <div className="divide-y rounded-xl border bg-card shadow-xs">{data.buildings.map((b: any) => <Link key={b.id} to={`/b/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="size-4" /></div>
            <div className="min-w-0 flex-1"><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{b.address}{b.city ? `, ${b.city}` : ""} · {b.units} {t("kavels")} · {b.members} {t("leden")}{b.next_av ? ` · ${t("AV")} ${fmtDateTime(b.next_av)}` : ""}</div>
              <div className="mt-1 flex flex-wrap gap-1">{b.urgent > 0 && <Badge variant="red">{b.urgent} {t("dringend")}</Badge>}{b.open_incidents > 0 && <Badge variant="warning">{b.open_incidents} {t("meldingen")}</Badge>}{b.overdue_units > 0 && <Badge variant="red">{eur(b.overdue_amount)} {t("vervallen")}</Badge>}{b.unmatched_bank > 0 && <Badge variant="secondary"><Landmark />{b.unmatched_bank}</Badge>}{b.open_polls > 0 && <Badge variant="info">{b.open_polls} {t("stemmingen")}</Badge>}{b.open_invites > 0 && <Badge variant="outline">{b.open_invites} {t("uitnodigingen open")}</Badge>}</div></div>
            <div className="hidden text-right text-xs text-muted-foreground sm:block"><div>{t("werk")} {eur(b.working_cash)}</div><div>{t("reserve")} {eur(b.reserve_cash)}</div></div><ChevronRight className="size-4 text-muted-foreground" />
          </Link>)}</div>}</section>
        <section><h2 className="mb-2 font-semibold">{t("Medewerkers van het kantoor")}</h2>
          <div className="divide-y rounded-xl border bg-card shadow-xs">{data.members.map((m: any) => <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="font-medium">{m.name}</span><span className="text-xs text-muted-foreground">{m.email}</span><Badge variant="secondary" className="ml-auto">{m.role}</Badge>{isAdmin && m.id !== user?.id && m.role !== "owner" && <Button size="icon-sm" variant="ghost" onClick={async () => { if (confirm(t("Medewerker verwijderen?"))) { await api.del(`/api/orgs/${orgId}/members/${m.id}`); reload(); } }}><Trash2 /></Button>}</div>)}
            {isAdmin && <div className="px-4 py-2"><Button size="sm" variant="outline" onClick={() => setInvite(true)}><UserPlus />{t("Medewerker toevoegen")}</Button></div>}</div>
          <p className="mt-1 text-xs text-muted-foreground">{t("Medewerkers van het kantoor hebben syndicusrechten in alle gebouwen van de organisatie.")}</p></section>
      </div>
      <aside><h2 className="mb-2 font-semibold">{t("Actiepunten")}</h2>
        {!data.actions.length ? <Empty title={t("Alles is in orde")} /> : <div className="divide-y rounded-xl border bg-card shadow-xs">{data.actions.map((a: any, i: number) => <Link key={i} to={a.link} className="flex items-start gap-2 px-3 py-2.5 text-sm hover:bg-muted/50"><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${a.severity === "high" ? "text-destructive" : a.severity === "medium" ? "text-amber-600" : "text-muted-foreground"}`} /><div className="min-w-0"><div>{(ACTION_TEXT[a.kind] ? t(ACTION_TEXT[a.kind]) : a.text).replace("{n}", String(a.n)).replace("{amount}", eur(a.amount ?? 0))}</div><div className="text-xs text-muted-foreground">{a.building}</div></div><Badge variant={SEV[a.severity]} className="ml-auto shrink-0">{{ high: t("nu"), medium: t("deze maand"), low: t("later") }[a.severity as string]}</Badge></Link>)}</div>}</aside>
    </div>
    <Dialog open={invite} onOpenChange={setInvite}><DialogContent><DialogHeader><DialogTitle>{t("Medewerker toevoegen")}</DialogTitle><DialogDescription>{t("Een bestaand account wordt meteen toegevoegd; anders ontvangt de persoon een uitnodiging om zich te registreren.")}</DialogDescription></DialogHeader>
      <form className="grid gap-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setError(null); try { const r = await api.post<any>(`/api/orgs/${orgId}/members`, { email, role }); toast.success(r.invited ? t("Uitnodiging verstuurd") : `${r.added} ${t("toegevoegd")}`); setInvite(false); setEmail(""); reload(); } catch (err) { setError(err); } }}>
        <Field label={t("E-mail")}><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t("Rol")}><Select value={role} onValueChange={setRole}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="staff">{t("Medewerker")}</SelectItem><SelectItem value="admin">{t("Beheerder")}</SelectItem></SelectContent></Select></Field>
        <ErrorBox error={error} /><DialogFooter><Button>{t("Toevoegen")}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
