import { Link, useLocation } from "react-router-dom";
import { MarkdownDoc } from "../components/MarkdownDoc";
import voorwaarden from "../../../docs/juridisch/voorwaarden.md?raw";
import privacy from "../../../docs/juridisch/privacy.md?raw";
import dpa from "../../../docs/juridisch/verwerkersovereenkomst.md?raw";
import beveiliging from "../../../docs/juridisch/beveiliging.md?raw";

export const LEGAL_PAGES: Record<string, { title: string; src: string }> = {
  "/voorwaarden": { title: "Algemene voorwaarden", src: voorwaarden },
  "/privacy": { title: "Privacyverklaring", src: privacy },
  "/verwerkersovereenkomst": { title: "Verwerkersovereenkomst", src: dpa },
  "/beveiliging": { title: "Beveiliging en subverwerkers", src: beveiliging },
};

/** Openbare juridische pagina's: ook zonder account leesbaar (vereist voor aanvaarding bij registratie). */
export function LegalPage() {
  const { pathname } = useLocation();
  const page = LEGAL_PAGES[pathname] ?? LEGAL_PAGES["/voorwaarden"];
  return <div className="min-h-screen bg-muted/40 p-4 sm:p-8">
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><Link to="/" className="flex items-center gap-2"><img src="/icon.svg" className="size-8 rounded-lg" alt="" /><span className="text-lg font-semibold tracking-tight">Trustee</span></Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{Object.entries(LEGAL_PAGES).map(([p, v]) => <Link key={p} to={p} className={p === pathname ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}>{v.title}</Link>)}</nav></div>
      <article className="prose-trustee rounded-xl border bg-card p-6 shadow-xs sm:p-8"><MarkdownDoc src={page.src} /></article>
    </div>
  </div>;
}

/** Korte juridische voettekst voor aanmeldschermen en de zijbalk. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return <span className={className}><Link className="hover:underline" to="/voorwaarden">Voorwaarden</Link> · <Link className="hover:underline" to="/privacy">Privacy</Link> · <Link className="hover:underline" to="/beveiliging">Beveiliging</Link></span>;
}
