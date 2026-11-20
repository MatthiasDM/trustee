# Trustee: syndicus- en VME-platform

Open source platform voor Belgische verenigingen van mede-eigenaars (VME) en syndici, gebouwd op Boek 3 BW.

- **Demo zonder account:** https://trustee.m-dm.org/demo (fictieve gegevens, verwijderd na 24 uur zonder activiteit)
- **Projectpagina:** https://matthiasdm.github.io/trustee/
- **Licentie:** [GNU GPL v3 of later](LICENSE), zonder enige garantie. Trustee is een hulpmiddel en geen juridisch advies. De teksten onder `docs/juridisch/` zijn ontwerpen.

Gebouwd op Cloudflare Workers:

- **Workers** (Hono API) + **Workers Assets** (React PWA)
- **D1** (SQLite) voor alle data, **R2** voor documenten, **KV** voor cache en rate limits
- **Web Push** (VAPID, geen externe dienst) + **e-mail** via Resend
- **UI**: [shadcn/ui](https://ui.shadcn.com) (Radix-primitives + Tailwind v4), Lucide-iconen, Inter, licht en donker thema
- **Cron trigger** (elke 15 min): stemmingen sluiten, herinneringen, back-ups, sessies opruimen

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

## Productie in de EU

De omgeving `production` in `wrangler.jsonc` bewaart alle gegevens in de EU. De jurisdictie van D1 en R2 ligt vast bij het aanmaken en is nadien niet meer te wijzigen.

```bash
npx wrangler login
npx wrangler d1 create trustee-prod --jurisdiction eu          # zet database_id in env.production
npx wrangler r2 bucket create trustee-prod-docs --jurisdiction eu
npx wrangler kv namespace create KV --env production           # zet id in env.production
npm run db:migrate:production

npm run vapid                                                  # sleutelpaar; de publieke sleutel in env.production › vars
npx wrangler secret put VAPID_PRIVATE_KEY --env production
npx wrangler secret put RESEND_API_KEY --env production
npx wrangler secret put RESEND_WEBHOOK_SECRET --env production # zie E-mail hieronder
# vul in env.production › vars: APP_URL (https://…), VAPID_SUBJECT, VAPID_PUBLIC_KEY, EMAIL_FROM, ACCESS_TEAM_DOMAIN, ACCESS_AUD

npm run deploy:production
```

`npm run deploy:production` controleert eerst de configuratie (`scripts/check-production.mjs`) en weigert bij placeholders, een bucket buiten de EU, `DEMO_MODE` anders dan `0`, een adres zonder https of ontbrekende secrets.

Wat "in de EU" hier wel en niet betekent:

- **D1 en R2** (alle gegevens, documenten en back-ups) staan en draaien in de EU.
- **KV** heeft geen jurisdictie. Er staan enkel tellers voor rate limiting, kortlevende 2FA-uitdagingen en de status van de laatste cron in, geen gegevens van gebouwen.
- **De Worker zelf** draait op het Cloudflare-datacenter dat het dichtst bij de bezoeker ligt. Voor bezoekers in België is dat in de EU, maar het is niet afgedwongen; dat kan enkel met de betaalde Data Localization Suite.
- **Resend** (e-mail) en de logs van Workers Observability zijn aparte verwerkingen; neem ze op in de lijst van subverwerkers.

In productie (`DEMO_MODE=0`) is tweestapsverificatie verplicht voor wie een gebouw beheert, en wordt elke toegang van een platformbeheerder (`users.is_superadmin`) tot een gebouw gelogd in het activiteitenlog van dat gebouw.

### Productie afschermen (Cloudflare Access)

De productie-omgeving is een interne instantie: ze is enkel bereikbaar voor wie door Cloudflare Access wordt toegelaten. De afscherming staat op twee plaatsen, zodat een fout in de ene de instantie niet openzet:

- **Cloudflare Access** staat vóór het adres en vraagt een aanmelding voor iemand de app te zien krijgt.
- **De API controleert zelf het Access-token** (`src/worker/lib/access.ts`): met `ACCESS_TEAM_DOMAIN` en `ACCESS_AUD` gezet, weigert `/api/*` elk verzoek zonder geldig token voor deze toepassing (403, `access_required`). Enkel `/api/webhooks/*` is uitgezonderd; die route heeft een eigen handtekening.

Instellen, vóór de eerste deploy:

1. Zero Trust › Access › Applications › *Add an application* › *Self-hosted*, met het adres uit `routes` in `env.production`. Voeg een policy *Allow* toe met enkel je eigen e-mailadres(sen).
2. Maak een tweede toepassing voor hetzelfde adres met pad `api/webhooks/resend` en een policy *Bypass* voor *Everyone*, anders bereikt Resend de webhook niet.
3. Zet in `env.production › vars` het teamdomein (`ACCESS_TEAM_DOMAIN`, bv. `mijnteam.cloudflareaccess.com`) en de *Application Audience (AUD) Tag* van de eerste toepassing (`ACCESS_AUD`).
4. `npm run deploy:production` controleert na de deploy of het adres naar Access doorstuurt en of de API zonder token weigert (`node scripts/check-production.mjs --access`).

De controle weigert te deployen zonder deze twee waarden of met `workers_dev` aan (het workers.dev-adres valt buiten de Access-toepassing). De statische bestanden van de app (dezelfde code als in deze repo) worden niet door de Worker maar door Access afgeschermd; alle gegevens lopen via de API.

### E-mail (Resend) en domein

1. Voeg in Resend je verzenddomein toe (bv. `trustee.be`) en zet de **DKIM**- en **SPF**-records (en optioneel DMARC) in je DNS; zonder die records belanden uitnodigingen in spam.
2. Zet `EMAIL_FROM` op een adres van dat domein, bv. `Trustee <noreply@trustee.be>`, en `RESEND_API_KEY` als secret.
3. Test met `POST /api/auth/forgot-password` op een eigen adres.
4. Maak in Resend een webhook naar `https://<domein>/api/webhooks/resend` voor de gebeurtenissen `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` en `email.suppressed`, en zet het ondertekeningsgeheim (`whsec_…`) als secret `RESEND_WEBHOOK_SECRET`. Zonder dat geheim bestaat de route niet. Een bounce of klacht markeert het lid als onbezorgbaar en verwittigt de syndicus; de bezorgstatus per bericht staat in `email_log` (`GET /api/buildings/:id/deliveries`).

### Beveiliging en bewaking

- Rate limiting (KV) op aanmelden, registreren, wachtwoord-reset en uitnodigingen.
- Uploads: enkel documenttypes (pdf, afbeeldingen, Office, csv, zip…), uitvoerbare bestanden en html geweigerd; voorvertoning in een gesandboxte iframe.
- Dagelijks maakt de cron een JSON-export per gebouw in R2 (`backups/<gebouw>/<datum>.json`, 36 maanden bewaard); syndicus, raad en commissaris kunnen ze downloaden onder Instellingen. De laatste cron-status staat daar ook.
- Workers Observability staat aan (`observability.enabled`); fouten verschijnen in het Cloudflare-dashboard onder Logs. Koppel daar een alert aan `cron failed` of 5xx-pieken.
- AVG: gebruikers downloaden hun gegevens en verwijderen hun account (geanonimiseerd; stemmen en boekingen blijven bewaard).

Koppel daarna een custom domain aan de Worker (Workers & Pages › trustee › Settings › Domains). `APP_URL` moet het publieke adres zijn; het wordt gebruikt in e-mails en push-links.

## Publieke demo hosten

`DEMO_ONLY=1` (omgeving `demo` in `wrangler.jsonc`) maakt een instantie die enkel wegwerp-demo's aanbiedt. De limieten staan in `src/worker/lib/publicdemo.ts`:

| Wat | Limiet |
|---|---|
| Bestand | 5 MB; pdf, afbeeldingen, Word, Excel, csv, txt, CODA |
| Opslag | 25 MB en 30 documenten per gebouw, 1 GB in totaal |
| Andere aanvragen | 64 KB |
| Verkeer per adres | 600 aanvragen, 300 API-lezingen en 60 schrijfacties per minuut |
| Nieuwe demo's | 5 per adres en 25 in totaal per dag, 100 tegelijk actief |
| Uitgeschakeld | registreren, aanmelden, wachtwoord-reset, 2FA, nieuwe gebouwen en organisaties, overdracht, push, e-mail |

De instantie kan op eigen hardware draaien: `npm run demo:release` bouwt ze, `wrangler dev` luistert enkel op 127.0.0.1, en een Cloudflare Tunnel maakt ze bereikbaar. De Worker in `deploy/edge/` staat op het publieke domein, weigert te grote aanvragen en te veel verkeer vóór ze de server bereiken, en toont een melding als de server uit staat. Met `EDGE_SECRET` weigert de server alles wat niet via die Worker komt. De geplande opruiming start je lokaal met een aanroep van `/cdn-cgi/handler/scheduled` (met `--test-scheduled`); hou dat pad buiten de tunnel.

## Testen

Drie lagen, allemaal lokaal en zonder Cloudflare-account:

| Laag | Commando | Wat |
|---|---|---|
| Unit | `npm test` | Pure logica: verdeelsleutels, gestructureerde mededeling, rekeningenstelsel, CSV/CODA-parsers, uploadvalidatie, PDF-generator (19 tests). Draait ook mee in `npm run build`. |
| API-scenario's | `npm run test:api` | Start een **geïsoleerde testomgeving** (eigen D1/R2/KV in `.wrangler/test-state`, verse migraties en seed, poort 5199, `TEST_MODE=1`) en speelt hele workflows af: onboarding en uitnodigingen, rechtenmatrix per rol, AV-flow (agenda, volmachten, quorum, stemming, notulen, 1/5-verzoek, schriftelijk besluit), boekhouding (handelingen, bank, CSV, matching, afrekening, periodiek, activa, begroting, tegenboeking, PDF, opvolging, overdracht), beveiliging (rate limit, uploads, sessies, kennisgeving, cron) en regressies (122 tests). |
| UI end-to-end | `npm run test:ui` | Playwright bedient de echte interface in Chromium (desktop en Pixel 7): aanmelden, vragen en meldingen, stemmen, documenten uploaden en voorvertonen, keuringen, boeken via handelingen, bankimport en matching, agendapunten, volmachten en quorum, stemming en notulen, taal en thema, kantoorportaal, mobiel menu (20 tests). Rapport in `playwright-report/`, trace en screenshot bij een fout in `test-results/`. |

`npm run test:all` draait alles. De testomgeving kan ook los gebruikt worden om handmatig te klikken zonder je dev-data te raken: `npm run test:env` (reset met `npm run test:env:reset`, stop met `npm run test:env:stop`).

Omdat de preview een aparte database en bucket heeft, kan testdata nooit in productie belanden. Let op: Cloudflare Workers staat maximaal 100.000 PBKDF2-iteraties toe; lokaal wordt dat niet afgedwongen, de preview wel (daarom staat die limiet in een unit-test).

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

## Demo-modus

Met `DEMO_MODE=1` (preview en testomgeving; lokaal via `.dev.vars`) is `/demo` actief: één klik maakt een volledig geseed wegwerpgebouw met vijf gebruikers (`seed/template.mjs` met een unieke suffix per demo), de demobalk onderaan wisselt van gebruiker (`POST /api/demo/switch`), en de cron verwijdert demo's na 24 uur zonder activiteit (gebouw met cascade, organisatie, gebruikers en R2-bestanden). Demo-accounts hebben adressen op `demo.invalid`; daarnaar wordt nooit e-mail verstuurd. In productie staat `DEMO_MODE` op `0`.
