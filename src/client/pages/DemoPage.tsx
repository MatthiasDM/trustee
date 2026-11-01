import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Clock, FileUp, Users, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { ErrorBox, Field } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { LegalLinks } from "./LegalPage";

/** Openbare demo: één klik maakt een volledig gevuld wegwerpgebouw met vijf rollen; na 24 u zonder activiteit verdwijnt alles. */
export function DemoPage() {
  const { refresh, demo_enabled, demo_only, loading } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("Residentie Zeezicht"); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const start = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { const r = await api.post<{ buildingId: string }>("/api/demo/start", { name }); await refresh(); nav(`/b/${r.buildingId}`); } catch (err) { setError(err); setBusy(false); } };
  return <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4"><div className="w-full max-w-lg">
    <div className="mb-6 flex items-center justify-center gap-2"><img src="/icon.svg" className="size-9 rounded-lg" alt="" /><span className="text-xl font-semibold tracking-tight">Trustee</span></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" />Probeer Trustee met een demogebouw</CardTitle><CardDescription>Je krijgt meteen een volledig ingevuld gebouw: vijf kavels, vijf gebruikers (syndicus, raad, twee mede-eigenaars, huurder), een geplande algemene vergadering, stemmingen, meldingen, documentenmappen en een jaar boekhouding. Alle gegevens zijn fictief.</CardDescription></CardHeader>
      <CardContent>
        {!loading && demo_enabled === false ? <p className="text-sm text-muted-foreground">De demo is op deze omgeving niet beschikbaar.</p> : <form onSubmit={start} className="grid gap-4">
          <Field label="Naam van je demogebouw"><Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} required /></Field>
          <ul className="grid gap-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><Users className="mt-0.5 size-4 shrink-0" />Met de balk onderaan wissel je met één klik van gebruiker en zie je wat elke rol kan en mag.</li>
            <li className="flex gap-2"><Building2 className="mt-0.5 size-4 shrink-0" />Je start als syndicus. Alles mag: boeken, oproepen, stemmen openen, documenten uploaden.</li>
            <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" />Na 24 uur zonder activiteit wordt het gebouw met alle gebruikers en bestanden automatisch verwijderd. Zet er dus niets echts in.</li>
            {demo_only && <li className="flex gap-2"><FileUp className="mt-0.5 size-4 shrink-0" />Uploads: pdf, afbeeldingen, Word, Excel, csv, txt en CODA, tot 5 MB per bestand en 25 MB per gebouw. E-mails en pushmeldingen worden niet verstuurd.</li>}
          </ul>
          <ErrorBox error={error} />
          <Button className="w-full" disabled={busy}>{busy ? "Gebouw wordt aangemaakt…" : "Start de demo"}</Button>
        </form>}
      </CardContent></Card>
    {!demo_only && <p className="mt-4 text-center text-sm text-muted-foreground">Al een account? <Link className="font-medium text-primary hover:underline" to="/login">Aanmelden</Link></p>}
    <LegalLinks className="mt-3 block text-center text-xs text-muted-foreground" />
  </div></div>;
}
