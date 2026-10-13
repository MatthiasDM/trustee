import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Scale } from "lucide-react";
import handleiding from "../../../docs/handleiding.md?raw";
import wetgeving from "../../../docs/wetgeving.md?raw";
import { PageHeader } from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, "-").replace(/(^-|-$)/g, "");

export function HelpPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "wet" ? "wet" : "handleiding";
  const src = tab === "wet" ? wetgeving : handleiding;
  const toc = useMemo(() => src.split("\n").filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, "")), [src]);
  return <div>
    <PageHeader title="Handleiding" subtitle="Hoe Trustee werkt en welke wettelijke regels het volgt." />
    <Tabs value={tab} onValueChange={(v) => setSp(v === "wet" ? { tab: "wet" } : {})} className="mb-6"><TabsList><TabsTrigger value="handleiding"><BookOpen />Handleiding</TabsTrigger><TabsTrigger value="wet"><Scale />Wettelijk kader</TabsTrigger></TabsList></Tabs>
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block"><div className="sticky top-6 rounded-xl border bg-card p-4 text-sm shadow-xs"><div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Inhoud</div><ul className="space-y-1">{toc.map((t) => <li key={t}><a href={`#${slug(t)}`} className="block rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">{t}</a></li>)}</ul></div></nav>
      <article className="prose-trustee max-w-3xl rounded-xl border bg-card p-6 shadow-xs sm:p-8">
        <Markdown remarkPlugins={[remarkGfm]} components={{
          h1: ({ children }) => <h1 className="mb-4 text-2xl font-semibold tracking-tight">{children}</h1>,
          h2: ({ children }) => <h2 id={slug(String(children))} className="mt-8 mb-3 scroll-mt-6 border-b pb-1.5 text-lg font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-5 mb-2 font-semibold">{children}</h3>,
          p: ({ children }) => <p className="my-3 text-sm leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5 text-sm leading-relaxed">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="my-4 rounded-r-lg border-l-4 border-primary/50 bg-primary/5 px-4 py-2 text-sm [&_p]:my-1">{children}</blockquote>,
          table: ({ children }) => <div className="my-4 overflow-x-auto rounded-lg border"><table className="w-full text-sm">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/60 text-left text-xs text-muted-foreground">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
          td: ({ children }) => <td className="border-t px-3 py-2 align-top">{children}</td>,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
          a: ({ children, href }) => <a href={href} className="text-primary underline-offset-2 hover:underline">{children}</a>,
        }}>{src}</Markdown>
      </article>
    </div>
  </div>;
}
