import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Calculator, Code2, Calendar, FileText, MessageSquare, ShieldCheck, Sparkles, Users, Vote } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { LegalLinks } from "./LegalPage";

const REPO_URL = "https://github.com/MatthiasDM/trustee";

const FEATURES = [
  { icon: Calendar, title: "Algemene vergadering", text: "Agendapunten van mede-eigenaars, oproeping met termijncontrole, volmachten, quorum, stemming naar aandelen en notulen binnen 30 dagen." },
  { icon: Vote, title: "Stemmingen en beslissingen", text: "Gewogen stemmen met de juiste meerderheid, schriftelijke besluitvorming bij eenparigheid, documenten gekoppeld aan elke stemming." },
  { icon: Calculator, title: "Boekhouding volgens KB 2012", text: "Dubbele boekhouding of kasboek, oproepen met gestructureerde mededeling, bankimport (CSV, CODA), jaarrekening en afrekening per kavel." },
  { icon: FileText, title: "Documenten en inzage", text: "Statuten, verslagen, offertes en facturen op één plaats, met het wettelijke inzagerecht van raad en commissaris en kennisgeving aan de syndicus." },
  { icon: MessageSquare, title: "Vragen, meldingen en tickets", text: "Bewoners melden, de syndicus antwoordt officieel en wijst toe aan een leverancier. Keuringen en attesten met vervaldata." },
  { icon: ShieldCheck, title: "Toezicht ingebouwd", text: "De AV beslist, de syndicus voert uit, raad en commissaris kijken mee. Elke handeling met rechtsgevolg wordt bevestigd en gelogd." },
];

/** Openbare startpagina voor bezoekers zonder account: uitleg, demo en aanmelden. */
export function LandingPage() {
  const { demo_enabled, demo_only } = useAuth();
  return <div className="min-h-screen bg-background">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><div className="flex items-center gap-2.5"><img src="/icon.svg" className="size-9 rounded-lg" alt="" /><span className="text-lg font-semibold tracking-tight">Trustee</span></div>
      <nav className="flex items-center gap-2"><Button variant="ghost" asChild><Link to="/help">Handleiding</Link></Button>{demo_only ? <Button variant="outline" asChild><a href={REPO_URL}><Code2 />GitHub</a></Button> : <Button variant="outline" asChild><Link to="/login">Aanmelden</Link></Button>}</nav></header>
    <main>
      <section className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-16">
        <div className="max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground"><Users className="size-3.5" />Voor VME's en syndici in België</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">De mede-eigenaars beslissen. <span className="text-primary">Trustee</span> houdt alles bij.</h1>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">Eén platform voor de vereniging van mede-eigenaars: algemene vergadering, stemmingen, documenten, meldingen en boekhouding, gebouwd op het Belgische appartementsrecht (Boek 3 BW) en het rekeningenstelsel van KB 12 juli 2012.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            {demo_enabled !== false && <Button size="lg" asChild><Link to="/demo"><Sparkles />Probeer de demo zonder account</Link></Button>}
            {demo_only ? <Button size="lg" variant="outline" asChild><a href={REPO_URL}><Code2 />Broncode (GPL)</a></Button> : <Button size="lg" variant="outline" asChild><Link to="/register">Registreer als syndicus<ArrowRight /></Link></Button>}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">De demo maakt met één klik een volledig ingevuld gebouw met vijf rollen. Fictieve gegevens, automatisch verwijderd na 24 uur zonder activiteit.{demo_only && " Dit is een publieke demo zonder garanties: zet er geen echte gegevens in."}</p>
        </div>
      </section>
      <section className="border-t bg-muted/30"><div className="mx-auto grid max-w-6xl gap-5 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {FEATURES.map((f) => <div key={f.title} className="rounded-xl border bg-card p-5 shadow-xs"><f.icon className="mb-3 size-5 text-primary" /><h2 className="font-semibold">{f.title}</h2><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p></div>)}
      </div></section>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6"><div className="grid gap-6 rounded-2xl border p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
        <div><h2 className="text-xl font-semibold">Zo werkt het, volgens de wet</h2><p className="mt-2 text-sm text-muted-foreground">Elke mede-eigenaar dient agendapunten in en stemt naar zijn aandelen. De syndicus agendeert, roept op, voert uit en boekt. De raad van mede-eigendom en de commissaris van de rekeningen hebben inzage in alles. De handleiding legt uit wat elke rol kan en mag, met de wetsartikelen erbij.</p></div>
        <Button variant="outline" asChild><Link to="/help"><BookOpen />Lees de handleiding</Link></Button>
      </div></section>
    </main>
    <footer className="border-t"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:px-6"><span>Trustee is een hulpmiddel; de syndicus en de organen van de VME blijven verantwoordelijk voor de naleving van de wet.</span><LegalLinks /></div></footer>
  </div>;
}
