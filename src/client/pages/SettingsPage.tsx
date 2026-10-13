import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useBuilding, useFetch } from "../components/Layout";
import { ErrorBox, Field, PageHeader, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Separator } from "../components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { api, fmtDateTime } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getPushSubscription, pushSupported, subscribePush, unsubscribePush } from "../lib/push";

function Row({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 py-2"><div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

export function SettingsPage() {
  const b = useBuilding();
  const { user, vapidPublicKey, refresh } = useAuth();
  const prefs = useFetch<{ notify_email: number; notify_push: number }>(`/api/buildings/${b.id}/me/preferences`);
  const info = useFetch<any>(b.isManager ? `/api/buildings/${b.id}` : null);
  const audit = useFetch<any[]>(b.isBoard ? `/api/buildings/${b.id}/audit` : null);
  const [pushOn, setPushOn] = useState(false);
  const [profile, setProfile] = useState({ name: user?.name ?? "", phone: user?.phone ?? "" });
  const [pw, setPw] = useState({ current: "", next: "" }); const [pwErr, setPwErr] = useState<unknown>(null);
  const [bf, setBf] = useState<any>(null); const [broadcast, setBroadcast] = useState({ title: "", body: "" });
  useEffect(() => { getPushSubscription().then((s) => setPushOn(!!s)); }, []);
  useEffect(() => { if (info.data) setBf({ name: info.data.name, address: info.data.address, postal_code: info.data.postal_code ?? "", city: info.data.city ?? "", enterprise_number: info.data.enterprise_number ?? "", total_shares: info.data.total_shares }); }, [info.data]);

  const togglePush = async (on: boolean) => {
    try {
      if (on) { if (!vapidPublicKey) return toast.error("Push is niet geconfigureerd op de server (VAPID)"); const ok = await subscribePush(vapidPublicKey); setPushOn(ok); if (!ok) toast.error("Toestemming geweigerd"); }
      else { await unsubscribePush(); setPushOn(false); }
    } catch (e) { toast.error((e as Error).message); }
  };
  const setPref = async (k: "notify_email" | "notify_push", v: boolean) => { await api.patch(`/api/buildings/${b.id}/me/preferences`, { [k]: v }); prefs.setData({ ...prefs.data!, [k]: +v }); };

  return <div className="max-w-3xl space-y-6">
    <PageHeader title="Instellingen" />
    <Card><CardHeader><CardTitle>Meldingen</CardTitle><CardDescription>Hoe wil je op de hoogte gehouden worden?</CardDescription></CardHeader><CardContent>
      {!pushSupported() ? <p className="text-sm text-muted-foreground">Push-meldingen worden niet ondersteund in deze browser. Op iPhone: voeg de app toe aan je beginscherm (Deel → Zet op beginscherm).</p> :
        <Row label="Push-meldingen op dit toestel" hint="Werkt ook wanneer de app gesloten is" checked={pushOn} onChange={togglePush} />}
      {pushOn && <Button size="sm" variant="outline" onClick={() => api.post("/api/notifications/push/test").then(() => toast.success("Testmelding verstuurd"))}>Test-push sturen</Button>}
      <Separator className="my-4" /><p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Voor {b.name}</p>
      {prefs.data && <><Row label="E-mailmeldingen" checked={!!prefs.data.notify_email} onChange={(v) => setPref("notify_email", v)} /><Row label="Push-meldingen" checked={!!prefs.data.notify_push} onChange={(v) => setPref("notify_push", v)} /></>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Profiel</CardTitle></CardHeader><CardContent>
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.patch("/api/auth/me", profile); await refresh(); toast.success("Profiel opgeslagen"); }}>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Naam"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field><Field label="Telefoon"><Input value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field></div>
        <Field label="E-mail"><Input value={user?.email} disabled /></Field>
        <Button className="w-fit">Opslaan</Button></form>
      <Separator className="my-5" />
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); setPwErr(null); try { await api.post("/api/auth/change-password", pw); setPw({ current: "", next: "" }); toast.success("Wachtwoord gewijzigd"); } catch (err) { setPwErr(err); } }}>
        <h3 className="text-sm font-medium">Wachtwoord wijzigen</h3>
        <div className="grid gap-4 sm:grid-cols-2"><Input type="password" placeholder="Huidig wachtwoord" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /><Input type="password" placeholder="Nieuw wachtwoord" autoComplete="new-password" minLength={8} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
        <ErrorBox error={pwErr} /><Button variant="outline" className="w-fit">Wijzigen</Button></form>
    </CardContent></Card>

    {b.isManager && bf && <Card><CardHeader><CardTitle>Gebouw (VME)</CardTitle></CardHeader><CardContent>
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.patch(`/api/buildings/${b.id}`, { ...bf, total_shares: Number(bf.total_shares) }); await refresh(); toast.success("Gebouw opgeslagen"); }}>
        <Field label="Naam"><Input value={bf.name} onChange={(e) => setBf({ ...bf, name: e.target.value })} /></Field>
        <Field label="Adres"><Input value={bf.address} onChange={(e) => setBf({ ...bf, address: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="Postcode"><Input value={bf.postal_code} onChange={(e) => setBf({ ...bf, postal_code: e.target.value })} /></Field><Field label="Gemeente" className="col-span-2"><Input value={bf.city} onChange={(e) => setBf({ ...bf, city: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Ondernemingsnummer"><Input value={bf.enterprise_number} onChange={(e) => setBf({ ...bf, enterprise_number: e.target.value })} /></Field><Field label="Totaal aandelen"><Input type="number" value={bf.total_shares} onChange={(e) => setBf({ ...bf, total_shares: e.target.value })} /></Field></div>
        <Button className="w-fit">Opslaan</Button></form>
    </CardContent></Card>}

    {b.isManager && <Card><CardHeader><CardTitle>Bericht aan alle leden</CardTitle><CardDescription>Stuurt direct een push- en e-mailmelding naar iedereen, zonder bericht op het prikbord.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-4" onSubmit={async (e: FormEvent) => { e.preventDefault(); await api.post(`/api/buildings/${b.id}/broadcast`, broadcast); setBroadcast({ title: "", body: "" }); toast.success("Bericht verstuurd"); }}>
        <Input placeholder="Titel" required value={broadcast.title} onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} /><Textarea placeholder="Bericht" required value={broadcast.body} onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })} />
        <Button className="w-fit">Versturen</Button></form></CardContent></Card>}

    {b.isBoard && <Card><CardHeader><CardTitle>Activiteitenlog</CardTitle></CardHeader><CardContent>{audit.loading ? <Spinner /> : <ul className="max-h-80 divide-y overflow-y-auto text-xs">{(audit.data ?? []).map((a) => <li key={a.id} className="flex gap-3 py-2"><span className="shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(a.created_at)}</span><span className="font-medium">{a.user_name ?? "systeem"}</span><span className="text-muted-foreground">{a.action}{a.meta ? ` · ${Object.values(JSON.parse(a.meta)).join(", ")}` : ""}</span></li>)}</ul>}</CardContent></Card>}
  </div>;
}
