import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, "-").replace(/(^-|-$)/g, "");

/** Markdown-weergave met de huisstijl (handleiding, wettelijk kader, juridische documenten). */
export function MarkdownDoc({ src }: { src: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{
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
        }}>{src}</Markdown>;
}
