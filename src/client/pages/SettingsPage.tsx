import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Separator } from "../components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { api, fmtDateTime, fmtSize } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SecurityCard } from "../components/SecurityCard";
import { getPushSubscription, pushSupported, subscribePush, unsubscribePush } from "../lib/push";
import { LOCALES, useT } from "../lib/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

function Row({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 py-2"><div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

export function SettingsPage() {
  const b = useBuilding();
  const { user, vapidPublicKey, refresh, logout } = useAuth();
  const nav = useNavigate();
  const backups = useFetch<any>(b.isBoard ? `/api/buildings/${b.id}/backups` : null);
  const [delPw, setDelPw] = useState(""); const [delErr, setDelErr] = useState<unknown>(null);
  const prefs = useFetch<{ notify_email: number; notify_push: number; ecomm_consent_at?: string | null; ecomm_consent_via?: string | null }>(`/api/buildings/${b.id}/me/preferences`);
  const info = useFetch<any>(b.isManager ? `/api/buildings/${b.id}` : null);
  const audit = useFetch<any[]>(b.isBoard ? `/api/buildings/${b.id}/audit` : null);
  const [pushOn, setPushOn] = useState(false);
  const [profile, setProfile] = useState({ name: user?.name ?? "", phone: user?.phone ?? "", locale: user?.locale ?? "nl" }); const t = useT();
  const [pw, setPw] = useState({ current: "", next: "" }); const [pwErr, setPwErr] = useState<unknown>(null);
  const [bf, setBf] = useState<any>(null); const [broadcast, setBroadcast] = useState({ title: "", body: "" });
  useEffect(() => { getPushSubscription().then((s) => setPushOn(!!s)); }, []);
  useEffect(() => { if (info.data) setBf({ name: info.data.name, address: info.data.address, postal_code: info.data.postal_code ?? "", city: info.data.city ?? "", enterprise_number: info.data.enterprise_number ?? "", total_shares: info.data.total_shares, av_period_start: info.data.av_period_start ?? "", av_period_days: info.data.av_period_days ?? 15, legal_proceedings: info.data.legal_proceedings ?? "", insurance_info: info.data.insurance_info ?? "", seat_address: info.data.seat_address ?? "", syndicus_info: info.data.syndicus_info ?? {} }); }, [info.data]);

  const togglePush = async (on: boolean) => {
    try {
      if (on) { if (!vapidPublicKey) return toast.error("Push is niet geconfigureerd op de server (VAPID)"); const ok = await subscribePush(vapidPublicKey); setPushOn(ok); if (!ok) toast.error("Toestemming geweigerd"); }
      else { await unsubscribePush(); setPushOn(false); }
    } catch (e) { toast.error((e as Error).message); }
  };
  const setPref = async (k: "notify_email" | "notify_push", v: boolean) => { await api.patch(`/api/buildings/${b.id}/me/preferences`, { [k]: v }); prefs.setData({ ...prefs.data!, [k]: +v }); };

  return <div className="max-w-3xl space-y-6">
    <PageHeader title={t("Instellingen")} />
    <Card><CardHeader><CardTitle>{t("Meldingen")}</CardTitle><CardDescription>Hoe wil je op de hoogte gehouden worden?</CardDescription></CardHeader><CardContent>
      {!pushSupported() ? <p className="text-sm text-muted-foreground">Push-meldingen worden niet ondersteund in deze browser. Op iPhone: voeg de app toe aan je beginscherm (Deel → Zet op beginscherm).</p> :
        <Row label={t("Push-meldingen op dit toestel")} hint="Werkt ook wanneer de app gesloten is" checked={pushOn} onChange={togglePush} />}
      {pushOn && <Button size="sm" variant="outline" onClick={() => api.post("/api/notifications/push/test").then(() => toast.success("Testmelding verstuurd"))}>Test-push sturen</Button>}
      <Separator className="my-4" /><p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Voor {b.name}</p>
      {prefs.data && <><Row label={t("E-mailmeldingen")} checked={!!prefs.data.notify_email} onChange={(v) => setPref("notify_email", v)} /><Row label={t("Push-meldingen")} checked={!!prefs.data.notify_push} onChange={(v) => setPref("notify_push", v)} />
        {b.role !== "huurder" && <><Separator className="my-3" /><Row label="Elektronische oproeping en kennisgeving" hint={prefs.data.ecomm_consent_at ? `Akkoord gegeven op ${new Date(prefs.data.ecomm_consent_at).toLocaleDateString("nl-BE")}${prefs.data.ecomm_consent_via === "written" ? " (schriftelijk, geregistreerd door de syndicus)" : ""}. Je ontvangt oproepingen voor de AV en de notulen via Trustee en e-mail in plaats van per aangetekende brief.` : "Zonder dit akkoord moet de syndicus je oproepingen en notulen per aangetekende brief sturen. Je kan het akkoord altijd intrekken."} checked={!!prefs.data.ecomm_consent_at} onChange={async (v) => { await api.patch(`/api/buildings/${b.id}/me/preferences`, { ecomm_consent: v }); prefs.reload(); toast.success(v ? "Akkoord geregistreerd" : "Akkoord ingetrokken"); }} /></>}</>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>{t("Profiel")}</CardTitle></CardHeader><CardContent>
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.patch("/api/auth/me", profile); await refresh(); toast.success("Profiel opgeslagen"); }}>
        <div className="grid gap-4 sm:grid-cols-3"><Field label={t("Naam")}><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field><Field label={t("Telefoon")}><Input value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field><Field label={t("Taal")}><Select value={profile.locale} onValueChange={(v) => setProfile({ ...profile, locale: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{LOCALES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent></Select></Field></div>
        <Field label={t("E-mail")}><Input value={user?.email} disabled /></Field>
        <Button className="w-fit">{t("Opslaan")}</Button></form>
      <Separator className="my-5" />
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setPwErr(null); try { await api.post("/api/auth/change-password", pw); setPw({ current: "", next: "" }); toast.success("Wachtwoord gewijzigd"); } catch (err) { setPwErr(err); } }}>
        <h3 className="text-sm font-medium">{t("Wachtwoord wijzigen")}</h3>
        <div className="grid gap-4 sm:grid-cols-2"><Input type="password" placeholder="Huidig wachtwoord" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /><Input type="password" placeholder="Nieuw wachtwoord" autoComplete="new-password" minLength={8} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
        <ErrorBox error={pwErr} /><Button variant="outline" className="w-fit">Wijzigen</Button></form>
    </CardContent></Card>

    <SecurityCard />

    {b.isManager && bf && <Card><CardHeader><CardTitle>Gebouw (VME)</CardTitle></CardHeader><CardContent>
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.patch(`/api/buildings/${b.id}`, { ...bf, total_shares: Number(bf.total_shares), av_period_start: bf.av_period_start || null, av_period_days: Number(bf.av_period_days), legal_proceedings: bf.legal_proceedings || null, insurance_info: bf.insurance_info || null, seat_address: bf.seat_address || null, syndicus_info: bf.syndicus_info }); await refresh(); toast.success("Gebouw opgeslagen"); }}>
        <Field label="Naam"><Input value={bf.name} onChange={(e) => setBf({ ...bf, name: e.target.value })} /></Field>
        <Field label="Adres"><Input value={bf.address} onChange={(e) => setBf({ ...bf, address: e.target.value })} /></Field>
        <Field label="Zetel van de VME" hint="De zetel is in het gebouw (art. 3.86 §1 BW). Bij een groep van gebouwen: het gebouw dat de basisakte aanwijst. Leeg = het adres hierboven. Aangetekende post aan de VME gaat naar deze zetel én naar de syndicus."><Input value={bf.seat_address} onChange={(e) => setBf({ ...bf, seat_address: e.target.value })} placeholder="bv. Zeedijk 12 (blok A), 8400 Oostende" /></Field>
        <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Gegevens van de syndicus voor het uittreksel aan de ingang (art. 3.89 §2)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{([["name", "Naam (persoon of vennootschap)"], ["legal_form", "Rechtsvorm (bv. BV)"], ["profession", "Beroep (natuurlijke persoon)"], ["address", "Woonplaats of maatschappelijke zetel"], ["enterprise_number", "Ondernemingsnummer"], ["phone", "Telefoon"], ["email", "E-mail"], ["consult_place", "Waar reglement en register te raadplegen zijn"]] as const).map(([k, l]) => <Field key={k} label={l}><Input value={(bf.syndicus_info as any)?.[k] ?? ""} onChange={(e) => setBf({ ...bf, syndicus_info: { ...(bf.syndicus_info as any), [k]: e.target.value } })} /></Field>)}</div>
        </details>
        <div className="grid grid-cols-3 gap-3"><Field label="Postcode"><Input value={bf.postal_code} onChange={(e) => setBf({ ...bf, postal_code: e.target.value })} /></Field><Field label="Gemeente" className="col-span-2"><Input value={bf.city} onChange={(e) => setBf({ ...bf, city: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Ondernemingsnummer"><Input value={bf.enterprise_number} onChange={(e) => setBf({ ...bf, enterprise_number: e.target.value })} /></Field><Field label="Totaal aandelen"><Input type="number" value={bf.total_shares} onChange={(e) => setBf({ ...bf, total_shares: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Start AV-periode (MM-DD)" hint="Periode uit het reglement van interne orde waarin de gewone AV plaatsvindt. Bepaalt de uiterste datum (3 weken vooraf) voor agendapunten van mede-eigenaars."><Input placeholder="03-01" pattern="\\d{2}-\\d{2}" value={bf.av_period_start} onChange={(e) => setBf({ ...bf, av_period_start: e.target.value })} /></Field><Field label="Duur AV-periode (dagen)"><Input type="number" min={1} max={60} value={bf.av_period_days} onChange={(e) => setBf({ ...bf, av_period_days: e.target.value })} /></Field></div>
        <Field label="Lopende gerechtelijke procedures" hint="Wordt vermeld in het overdrachtsdossier bij verkoop van een kavel (art. 3.94 §1 BW)."><Textarea value={bf.legal_proceedings} onChange={(e) => setBf({ ...bf, legal_proceedings: e.target.value })} placeholder="Geen" /></Field>
        <Field label="Verzekeringen (polisnummers, maatschappij)"><Textarea value={bf.insurance_info} onChange={(e) => setBf({ ...bf, insurance_info: e.target.value })} /></Field>
        <Button className="w-fit">Opslaan</Button></form>
    </CardContent></Card>}

    {b.isManager && <Card><CardHeader><CardTitle>Bericht aan alle leden</CardTitle><CardDescription>Stuurt direct een push- en e-mailmelding naar iedereen, zonder bericht op het prikbord.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.post(`/api/buildings/${b.id}/broadcast`, broadcast); setBroadcast({ title: "", body: "" }); toast.success("Bericht verstuurd"); }}>
        <Input placeholder="Titel" required value={broadcast.title} onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} /><Textarea placeholder="Bericht" required value={broadcast.body} onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })} />
        <Button className="w-fit">Versturen</Button></form></CardContent></Card>}

    {b.isBoard && <Card><CardHeader><CardTitle>Archief, back-ups en systeemstatus</CardTitle><CardDescription>De VME bezit haar archief: download het volledige archief (alle gegevens én documenten als zip) wanneer je wil, ook bij een syndicuswissel of het einde van het abonnement. Daarnaast bewaart Trustee elke nacht een export (dagelijks 60 dagen, maandelijks 36 maanden).</CardDescription></CardHeader><CardContent>
      <div className="mb-3 flex flex-wrap gap-2">{(b.isManager || b.role === "raad") && <Button size="sm" asChild><a href={`/api/buildings/${b.id}/archive.zip`}><Download />Volledig archief (zip)</a></Button>}<Button size="sm" variant="outline" asChild><a href={`/api/buildings/${b.id}/export`}><Download />Gegevens (JSON)</a></Button></div>
      {backups.data && <><ul className="divide-y text-sm">{backups.data.backups.slice(0, 12).map((x: any) => <li key={x.key} className="flex items-center justify-between py-1.5"><a className="text-primary hover:underline" href={`/api/buildings/${b.id}/backups/${x.key}`}>{x.key.split("/").pop()}</a><span className="text-xs text-muted-foreground">{fmtSize(x.size)}</span></li>)}{!backups.data.backups.length && <li className="py-2 text-muted-foreground">Nog geen automatische back-up (de eerste volgt vannacht).</li>}</ul>
        <p className="mt-3 text-xs text-muted-foreground">Laatste achtergrondtaak: {backups.data.last_cron ? `${fmtDateTime(backups.data.last_cron.started_at)} · ${backups.data.last_cron.ok ? "geslaagd" : `mislukt: ${backups.data.last_cron.error}`} · ${backups.data.last_cron.duration_ms} ms` : "nog niet uitgevoerd"}</p></>}
    </CardContent></Card>}

    <Card><CardHeader><CardTitle>{t("Privacy (AVG)")}</CardTitle><CardDescription>Download al je gegevens of verwijder je account. Stemmen, boekingen en notulen blijven geanonimiseerd bewaard omdat de wet dat vereist.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <Button size="sm" variant="outline" className="w-fit" asChild><a href="/api/auth/me/export"><Download />{t("Mijn gegevens downloaden (JSON)")}</a></Button>
      <form className="grid gap-2 rounded-lg border border-destructive/30 p-3" onSubmit={async (e: FormEvent) => { e.preventDefault(); setDelErr(null); if (!confirm("Je account definitief verwijderen?")) return; try { await api.del("/api/auth/me", { password: delPw }); await logout(); nav("/login"); } catch (err) { setDelErr(err); } }}><div className="flex items-center gap-2 text-sm font-medium text-destructive"><ShieldAlert className="size-4" />{t("Account verwijderen")}</div><div className="flex gap-2"><Input type="password" placeholder="Bevestig met je wachtwoord" required value={delPw} onChange={(e) => setDelPw(e.target.value)} /><Button variant="destructive">Verwijderen</Button></div><ErrorBox error={delErr} /></form>
    </CardContent></Card>

    {b.isBoard && <Card><CardHeader><CardTitle>Activiteitenlog</CardTitle></CardHeader><CardContent>{audit.loading ? <Spinner /> : <ul className="max-h-80 divide-y overflow-y-auto text-xs">{(audit.data ?? []).map((a) => <li key={a.id} className="flex gap-3 py-2"><span className="shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(a.created_at)}</span><span className="font-medium">{a.user_name ?? "systeem"}</span><span className="text-muted-foreground">{a.action}{a.meta ? ` · ${Object.values(JSON.parse(a.meta)).join(", ")}` : ""}</span></li>)}</ul>}</CardContent></Card>}
  </div>;
}
