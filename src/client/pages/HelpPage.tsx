import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Scale } from "lucide-react";
import handleiding from "../../../docs/handleiding.md?raw";
import wetgeving from "../../../docs/wetgeving.md?raw";
import { PageHeader } from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useLocale, useT } from "../lib/i18n";
import { MarkdownDoc, slug } from "../components/MarkdownDoc";
import { LAW_VERIFIED_ON } from "../../shared/legal";
import { Link } from "react-router-dom";


export function HelpPage() {
  const [sp, setSp] = useSearchParams(); const t = useT(); const locale = useLocale();
  const tab = sp.get("tab") === "wet" ? "wet" : "handleiding";
  const src = tab === "wet" ? wetgeving : handleiding;
  const toc = useMemo(() => src.split("\n").filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, "")), [src]);
  return <div>
    <PageHeader title={t("Handleiding")} subtitle={t("Hoe Trustee werkt en welke wettelijke regels het volgt.")} />
    <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Deze handleiding en het wettelijk kader zijn <strong>informatief</strong>. Trustee is een hulpmiddel; de syndicus en de organen van de VME blijven verantwoordelijk voor de naleving van de wet. Wettelijk kader laatst geverifieerd op Justel op {LAW_VERIFIED_ON}. Zie ook de <Link className="underline" to="/voorwaarden">algemene voorwaarden</Link>, de <Link className="underline" to="/privacy">privacyverklaring</Link> en <Link className="underline" to="/beveiliging">beveiliging en subverwerkers</Link>.</p>
    {locale !== "nl" && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{t("De handleiding en het wettelijk kader zijn momenteel enkel in het Nederlands beschikbaar.")}</p>}
    <Tabs value={tab} onValueChange={(v) => setSp(v === "wet" ? { tab: "wet" } : {})} className="mb-6"><TabsList><TabsTrigger value="handleiding"><BookOpen />{t("Handleiding")}</TabsTrigger><TabsTrigger value="wet"><Scale />{t("Wettelijk kader")}</TabsTrigger></TabsList></Tabs>
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block"><div className="sticky top-6 rounded-xl border bg-card p-4 text-sm shadow-xs"><div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Inhoud</div><ul className="space-y-1">{toc.map((t) => <li key={t}><a href={`#${slug(t)}`} className="block rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">{t}</a></li>)}</ul></div></nav>
      <article className="prose-trustee max-w-3xl rounded-xl border bg-card p-6 shadow-xs sm:p-8">
        <MarkdownDoc src={src} />
      </article>
    </div>
  </div>;
}
