# Trustee — syndicus / VME platform

Cloud-based SaaS voor syndici en verenigingen van mede-eigenaars (VME), volledig op Cloudflare:

- **Workers** (Hono API) + **Workers Assets** (React PWA)
- **D1** (SQLite) voor alle data, **R2** voor documenten, **KV** gereserveerd voor cache/rate-limits
- **Web Push** (VAPID, geen externe dienst) + **e-mail** via Resend
- **UI**: [shadcn/ui](https://ui.shadcn.com) (Radix-primitives + Tailwind v4), Lucide-iconen, Inter, licht/donker thema; componenten staan in `src/client/components/ui/`
- **Cron trigger** (elke 15 min): sluit verlopen stemmingen, stuurt herinneringen 24u vóór vergaderingen, ruimt sessies op

## Functies

| Module | Wat |
|---|---|
| Multi-tenant | Organisaties (syndicuskantoren) → gebouwen (VME's) → leden met rollen: syndicus, raad van mede-eigendom, commissaris, mede-eigenaar, huurder |
| Kavels | Appartementen/garages/bergingen met quotiteiten (aandelen) en (gedeelde) eigenaars |
| Uitnodigingen | Per e-mail met token, rol en kavel; bulk via CSV |
| Documenten | Mappen, categorieën, zichtbaarheid per rol, versies, zoeken, drag-and-drop upload (R2, max 50 MB), optioneel iedereen verwittigen |
| Vragen & meldingen | Vragen, schademeldingen (met prioriteit/status) en mededelingen; privé aan de syndicus; reacties; officieel antwoord; vastpinnen |
| Stemmingen | Gewogen volgens quotiteiten of 1 stem p.p., meerderheidsdrempels (1/2, 2/3, 4/5, eenparigheid), anoniem, meerdere keuzes, sluitdatum, CSV-export |
| Vergaderingen | AV / BAV / raad, agenda, aanwezigheid (ja / volmacht / nee), verslag koppelen, .ics export, herinnering |
| Meldingen | In-app inbox, Web Push (PWA, ook iOS vanaf beginscherm), e-mail; voorkeuren per gebouw |
| Beheer | Broadcast naar alle leden, activiteitenlog (audit), wachtwoord vergeten/reset |

## Lokaal starten

```bash
npm install
npm run db:migrate:local
npm run db:seed:local          # demo-data (zie hieronder)
cp .dev.vars.example .dev.vars # vul VAPID-sleutels in (npm run vapid)
npm run dev                    # http://localhost:5173
```

Demo-accounts (wachtwoord `wachtwoord123`): `syndicus@demo.be` (syndicus), `jan@demo.be` (raad), `marie@demo.be` / `ahmed@demo.be` (eigenaars), `lotte@demo.be` (huurder).

Zonder `RESEND_API_KEY` worden e-mails naar de console gelogd.

## Deployen naar Cloudflare

```bash
npx wrangler login
npx wrangler d1 create trustee-db        # zet database_id in wrangler.jsonc
npx wrangler r2 bucket create trustee-docs --jurisdiction eu   # EU-opslag, zoals de handleiding belooft
npx wrangler kv namespace create KV      # zet id in wrangler.jsonc
npm run db:migrate:remote

npm run vapid                             # genereert sleutelpaar
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put RESEND_API_KEY    # optioneel
# zet VAPID_PUBLIC_KEY, APP_URL (https://…), VAPID_SUBJECT en EMAIL_FROM in wrangler.jsonc › vars

npm run deploy
```

### E-mail (Resend) en domein

1. Voeg in Resend je verzenddomein toe (bv. `trustee.be`) en zet de **DKIM**- en **SPF**-records (en optioneel DMARC) in je DNS; zonder die records belanden uitnodigingen in spam.
2. Zet `EMAIL_FROM` op een adres van dat domein, bv. `Trustee <noreply@trustee.be>`, en `RESEND_API_KEY` als secret.
3. Test met `POST /api/auth/forgot-password` op een eigen adres.

### Beveiliging en bewaking

- Rate limiting (KV) op aanmelden, registreren, wachtwoord-reset en uitnodigingen.
- Uploads: enkel documenttypes (pdf, afbeeldingen, Office, csv, zip…), uitvoerbare bestanden en html geweigerd; voorvertoning in een gesandboxte iframe.
- Elke eerste van de maand maakt de cron een JSON-export per gebouw in R2 (`backups/<gebouw>/<datum>.json`, 36 maanden bewaard); syndicus, raad en commissaris kunnen ze downloaden onder Instellingen. De laatste cron-status staat daar ook.
- Workers Observability staat aan (`observability.enabled`); fouten verschijnen in het Cloudflare-dashboard onder Logs. Koppel daar een alert aan `cron failed` of 5xx-pieken.
- AVG: gebruikers downloaden hun gegevens en verwijderen hun account (geanonimiseerd; stemmen en boekingen blijven bewaard).

Koppel daarna een custom domain aan de Worker (Workers & Pages › trustee › Settings › Domains). `APP_URL` moet het publieke adres zijn; het wordt gebruikt in e-mails en push-links.

## Testen

Drie lagen, allemaal lokaal en zonder Cloudflare-account:

| Laag | Commando | Wat |
|---|---|---|
| Unit | `npm test` | Pure logica: verdeelsleutels, gestructureerde mededeling, rekeningenstelsel, CSV/CODA-parsers, uploadvalidatie, PDF-generator (19 tests). Draait ook mee in `npm run build`. |
| API-scenario's | `npm run test:api` | Start een **geïsoleerde testomgeving** (eigen D1/R2/KV in `.wrangler/test-state`, verse migraties en seed, poort 5199, `TEST_MODE=1`) en speelt hele workflows af: onboarding en uitnodigingen, rechtenmatrix per rol, AV-flow (agenda, volmachten, quorum, stemming, notulen, 1/5-verzoek, schriftelijk besluit), boekhouding (handelingen, bank, CSV, matching, afrekening, periodiek, activa, begroting, tegenboeking, PDF, opvolging, overdracht), beveiliging (rate limit, uploads, sessies, kennisgeving, cron) en regressies (122 tests). |
| UI end-to-end | `npm run test:ui` | Playwright bedient de echte interface in Chromium (desktop en Pixel 7): aanmelden, vragen en meldingen, stemmen, documenten uploaden en voorvertonen, keuringen, boeken via handelingen, bankimport en matching, agendapunten, volmachten en quorum, stemming en notulen, taal en thema, kantoorportaal, mobiel menu (20 tests). Rapport in `playwright-report/`, trace en screenshot bij een fout in `test-results/`. |

`npm run test:all` draait alles. De testomgeving kan ook los gebruikt worden om handmatig te klikken zonder je dev-data te raken: `npm run test:env` (reset met `npm run test:env:reset`, stop met `npm run test:env:stop`).

**Kortlevende deployments**: `npm run deploy:preview` laadt een versie op zonder ze live te zetten (`wrangler versions upload`) en geeft een preview-URL terug. Dat vereist `wrangler login` en de productie-bindingen; gebruik voor preview-tests een aparte D1-database (`wrangler d1 create trustee-preview`) en zet die in een `env.preview`-blok in `wrangler.jsonc`, zodat testdata nooit in productie belandt.

## Structuur

```
src/worker/        Hono API (routes/auth, buildings, documents, posts, polls, meetings, notifications)
src/worker/lib/    auth (PBKDF2 + sessiecookies), notify (in-app + push + mail fan-out), push (VAPID), email (Resend)
src/client/        React 19 + React Router + Tailwind v4 PWA (shadcn/ui in components/ui, thema-tokens in styles.css)
src/shared/        gedeelde types en labels
migrations/        D1-migraties   seed/   demo-data   public/sw.js   service worker (push + cache)
```

## API (samenvatting)

Alle routes onder `/api`, sessiecookie-auth. Gebouwroutes controleren lidmaatschap en rol.

- `POST /auth/register|login|logout|forgot-password|reset-password`, `GET/PATCH /auth/me`, `GET /auth/invite/:token`, `POST /auth/invite/:token/accept`
- `POST /buildings`, `GET/PATCH /buildings/:id`, `…/members`, `…/invites`, `…/units`, `…/units/:id/owners`, `…/audit`, `…/broadcast`, `…/me/preferences`
- `…/folders`, `…/documents` (multipart upload), `…/documents/:id/download|version`
- `…/posts`, `…/posts/:id`, `…/posts/:id/comments`
- `…/polls`, `…/polls/:id`, `…/polls/:id/vote`, `…/polls/:id/export.csv`
- `…/meetings`, `…/meetings/:id/rsvp|rsvps|ics`
- `GET /notifications`, `POST /notifications/read`, `POST /notifications/push/subscribe|unsubscribe|test`
