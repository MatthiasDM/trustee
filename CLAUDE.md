# Trustee — syndicus / VME platform

- Rollen, rechten en termijnen volgen het Belgische appartementsrecht. **Bron van waarheid: `docs/wetgeving.md`** (geverifieerd op Justel). Pas eerst dat document aan, dan de code (`src/worker/lib/auth.ts`, `src/worker/routes/mandates.ts`, `agenda.ts`, `documents.ts`).
- De handleiding voor gebruikers staat in `docs/handleiding.md`; beide bestanden worden integraal getoond op `/help` in de app (import via `?raw`). Rechten in de rollentabel van de handleiding moeten overeenkomen met de middleware in de routes.
- UI: shadcn/ui-componenten in `src/client/components/ui/`, thema-tokens in `src/client/styles.css`, Lucide-iconen, geen emoji.
- Stack: Cloudflare Workers (Hono) + D1 + R2 + Web Push; React/Vite PWA. Lokaal: `npm run dev`, migraties `npm run db:migrate:local`, seed `npm run db:seed:local` (seed wordt gegenereerd met `npm run seed:generate`, nooit in `migrations/` zetten).
