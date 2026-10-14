import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorBox, Field, Spinner, RoleBadge } from "../components/ui";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { LegalLinks } from "./LegalPage";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { useT } from "../lib/i18n";

function AcceptTerms({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-start gap-2 text-sm"><Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" /><span>Ik aanvaard de <Link className="underline" to="/voorwaarden" target="_blank">algemene voorwaarden</Link> en de <Link className="underline" to="/privacy" target="_blank">privacyverklaring</Link>.</span></label>;
}

function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center justify-center gap-2"><img src="/icon.svg" className="size-9 rounded-lg" alt="" /><span className="text-xl font-semibold tracking-tight">Trustee</span></div>
      <Card><CardHeader><CardTitle className="text-xl">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent>{children}</CardContent></Card>
      {footer && <p className="mt-4 text-center text-sm text-muted-foreground">{footer}</p>}
      <LegalLinks className="mt-3 block text-center text-xs text-muted-foreground" />
    </div></div>;
}

export function LoginPage() {
  const { refresh, user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const t = useT();
  useEffect(() => { if (user) nav(sp.get("next") || "/", { replace: true }); }, [user]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post("/api/auth/login", { email, password }); await refresh(); nav(sp.get("next") || "/"); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <AuthCard title={t("Aanmelden")} description={t("Welkom terug bij je VME-platform.")} footer={<>{t("Nog geen account?")} <Link className="font-medium text-primary hover:underline" to="/register">{t("Registreer als syndicus")}</Link></>}>
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t("E-mail")}><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label={t("Wachtwoord")}><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <ErrorBox error={error} />
      <Button className="w-full" disabled={busy}>{t("Aanmelden")}</Button>
      <p className="text-center text-sm"><Link to="/forgot-password" className="text-muted-foreground hover:text-primary">{t("Wachtwoord vergeten?")}</Link></p>
    </form>
  </AuthCard>;
}

export function RegisterPage() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", orgName: "", accept_terms: false });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const t = useT();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post("/api/auth/register", f); await refresh(); nav("/"); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <AuthCard title={t("Account aanmaken")} description={t("Voor syndici en beheerders. Mede-eigenaars worden uitgenodigd door hun syndicus.")} footer={<>{t("Al een account?")} <Link className="font-medium text-primary hover:underline" to="/login">{t("Aanmelden")}</Link></>}>
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t("Naam kantoor / organisatie")}><Input required value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} placeholder="bv. Syndicus Janssens bv" /></Field>
      <Field label={t("Jouw naam")}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t("E-mail")}><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label={t("Wachtwoord")} hint={t("Minstens 8 tekens")}><Input type="password" autoComplete="new-password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <AcceptTerms checked={f.accept_terms} onChange={(v) => setF({ ...f, accept_terms: v })} />
      <ErrorBox error={error} />
      <Button className="w-full" disabled={busy || !f.accept_terms}>{t("Account aanmaken")}</Button>
    </form>
  </AuthCard>;
}

export function InvitePage() {
  const { token } = useParams();
  const { user, refresh, loading } = useAuth();
  const nav = useNavigate();
  const [inv, setInv] = useState<any>(null); const [error, setError] = useState<unknown>(null);
  const [f, setF] = useState({ name: "", password: "", accept_terms: false }); const [busy, setBusy] = useState(false); const t = useT();
  useEffect(() => { api.get<any>(`/api/auth/invite/${token}`).then((i) => { setInv(i); setF((p) => ({ ...p, name: i.name ?? "" })); }).catch(setError); }, [token]);
  if (error && !inv) return <AuthCard title="Uitnodiging"><ErrorBox error={error} /></AuthCard>;
  if (!inv || loading) return <Spinner />;
  const accept = async () => {
    setBusy(true); setError(null);
    try {
      if (user) { const r = await api.post<any>(`/api/auth/invite/${token}/accept`); await refresh(); nav(`/b/${r.buildingId}`); }
      else { await api.post("/api/auth/register", { name: f.name, email: inv.email, password: f.password, inviteToken: token, accept_terms: f.accept_terms }); await refresh(); nav("/"); }
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <AuthCard title={`Uitnodiging voor ${inv.building_name}`} description={inv.address}>
    <div className="mb-4 flex items-center gap-2 text-sm">Rol: <RoleBadge role={inv.role} />{inv.unit_label && <Badge variant="secondary">Kavel {inv.unit_label}</Badge>}</div>
    {inv.expired ? <ErrorBox error={new Error("Deze uitnodiging is verlopen. Vraag je syndicus om een nieuwe.")} /> : inv.accepted_at ? <ErrorBox error={new Error("Deze uitnodiging werd al gebruikt.")} /> :
      user ? (user.email.toLowerCase() === inv.email.toLowerCase()
        ? <div className="grid gap-3"><p className="text-sm">Je bent aangemeld als <strong>{user.email}</strong>.</p><ErrorBox error={error} /><Button onClick={accept} disabled={busy}>Uitnodiging accepteren</Button></div>
        : <p className="text-sm text-destructive">Deze uitnodiging is voor {inv.email}, maar je bent aangemeld als {user.email}. Meld je af en probeer opnieuw.</p>)
      : inv.has_account ? <div className="grid gap-3"><p className="text-sm">Er bestaat al een account voor {inv.email}. Meld je aan om de uitnodiging te accepteren.</p><Button asChild><Link to={`/login?next=/invite/${token}`}>Aanmelden</Link></Button></div>
      : <form onSubmit={(e) => { e.preventDefault(); accept(); }} className="grid gap-4">
          <Field label="E-mail"><Input value={inv.email} disabled /></Field>
          <Field label={t("Jouw naam")}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Kies een wachtwoord"><Input type="password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <AcceptTerms checked={f.accept_terms} onChange={(v) => setF({ ...f, accept_terms: v })} />
          <ErrorBox error={error} /><Button disabled={busy || !f.accept_terms}>Account aanmaken & toetreden</Button>
        </form>}
  </AuthCard>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(false);
  return <AuthCard title="Wachtwoord vergeten" footer={<Link to="/login" className="text-primary hover:underline">Terug naar aanmelden</Link>}>
    {done ? <p className="text-sm">Als er een account bestaat voor {email}, ontvang je zo een e-mail met een link.</p> :
      <form onSubmit={async (e) => { e.preventDefault(); await api.post("/api/auth/forgot-password", { email }); setDone(true); }} className="grid gap-4">
        <Field label="E-mail"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Button className="w-full">Verstuur link</Button>
      </form>}
  </AuthCard>;
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams(); const nav = useNavigate();
  const [password, setPassword] = useState(""); const [error, setError] = useState<unknown>(null);
  return <AuthCard title="Nieuw wachtwoord">
    <form onSubmit={async (e) => { e.preventDefault(); try { await api.post("/api/auth/reset-password", { token: sp.get("token"), password }); nav("/login"); } catch (err) { setError(err); } }} className="grid gap-4">
      <Field label="Nieuw wachtwoord"><Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <ErrorBox error={error} /><Button className="w-full">Opslaan</Button>
    </form>
  </AuthCard>;
}
