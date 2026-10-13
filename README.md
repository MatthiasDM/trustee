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
npx wrangler r2 bucket create trustee-docs
npx wrangler kv namespace create KV      # zet id in wrangler.jsonc
npm run db:migrate:remote

npm run vapid                             # genereert sleutelpaar
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put RESEND_API_KEY    # optioneel
# zet VAPID_PUBLIC_KEY, APP_URL (https://…), VAPID_SUBJECT en EMAIL_FROM in wrangler.jsonc › vars

npm run deploy
```

Koppel daarna een custom domain aan de Worker (Workers & Pages › trustee › Settings › Domains). `APP_URL` moet het publieke adres zijn; het wordt gebruikt in e-mails en push-links.

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
