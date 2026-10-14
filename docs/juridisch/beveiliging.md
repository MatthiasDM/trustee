# Beveiliging en subverwerkers

**Versie 2026-10-14.** Wat we doen om de gegevens van VME's te beschermen, en bij wie ze staan.

## Subverwerkers

| Partij | Rol | Locatie | Grondslag |
|---|---|---|---|
| Cloudflare, Inc. | Hosting van de applicatie (Workers), database (D1), bestandsopslag (R2, jurisdictie EU), sleutel-waarde-opslag (KV) | Europese Unie | Cloudflare Data Processing Addendum met standaardcontractbepalingen |
| Resend | Verzending van e-mail (uitnodigingen, meldingen, wachtwoordherstel) | EU-regio | Verwerkersovereenkomst Resend |

Geen andere partijen krijgen persoonsgegevens. Geen analytics- of advertentiediensten.

## Maatregelen

- **Toegang**: per gebouw en per rol afgedwongen op de server; mede-eigenaars zien enkel hun eigen kavelgegevens; raad en commissaris hebben wettelijk inzagerecht, met kennisgeving aan de syndicus.
- **Authenticatie**: wachtwoorden gehasht met PBKDF2-SHA256 (100.000 iteraties), sessies van 30 dagen in een HttpOnly-cookie, tweestapsverificatie (TOTP) voor syndici en kantoorleden, rate limiting op aanmelden, registreren en wachtwoordherstel.
- **Versleuteling**: TLS voor alle verkeer; opslag bij Cloudflare versleuteld at rest.
- **Audit-log**: elke beheershandeling (leden, documenten, boekingen, vergaderingen, stemmingen, instellingen) wordt gelogd met gebruiker en tijdstip en is zichtbaar voor syndicus, raad en commissaris.
- **Back-ups**: dagelijkse export per gebouw naar aparte opslag, 36 maanden bewaard; hersteltest elk kwartaal.
- **Prullenbak**: verwijderde documenten blijven 30 dagen herstelbaar.
- **Scheiding**: aparte test- en previewomgevingen met eigen database en opslag; productiegegevens worden nooit in testomgevingen gebruikt.
- **Ontwikkeling**: geautomatiseerde tests op drie lagen (eenheid, API-scenario's, browser) bij elke wijziging; wettelijke regels staan in één gedocumenteerd bronbestand met verificatiedatum.
- **Incidenten**: procedure voor melding aan klanten binnen 24 uur; contact *[security e-mailadres]*.

## Melden van kwetsbaarheden

Vond je een beveiligingsprobleem? Mail *[security e-mailadres]*. We bevestigen binnen 2 werkdagen en vervolgen te goeder trouw handelende melders niet.
