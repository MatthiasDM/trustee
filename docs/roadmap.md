# Inventaris: verbeteringen en ontbrekende functies

Stand op 13 oktober 2026, na de bouw van de boekhoudmodule. Gerangschikt per domein; binnen elk domein eerst wat het meeste waarde oplevert. **(W)** = wettelijk relevant, **(R)** = nodig vóór productie, **(G)** = gebruiksgemak.

## 1. Productierijp maken (R)

- **E-mail via een eigen domein**: Resend is gekoppeld maar niet geconfigureerd; DKIM/SPF voor het verzenddomein, anders belanden uitnodigingen in spam.
- **Rate limiting en brute-force-bescherming** op login, wachtwoord-reset en uitnodigingen (KV-binding is al voorzien, nog niet gebruikt).
- **Bestandsvalidatie bij upload**: enkel toegelaten MIME-types, virusscan of minstens blokkeren van uitvoerbare bestanden; voorvertoning van PDF en afbeeldingen in de app.
- **Back-ups**: D1 Time Travel is er standaard, maar een geplande export (JSON/CSV) naar R2 per gebouw ontbreekt; relevant voor de bewaartermijn van 7 jaar (W).
- **Monitoring**: foutmeldingen naar een logkanaal, cron-uitvoeringen zichtbaar voor de beheerder.
- **Geautomatiseerde tests** op de kritieke paden: rechtenmatrix per rol, balanscontrole, CODA/CSV-parsers, afrekening per kavel. Nu enkel manueel getest.
- **Account verwijderen / gegevens exporteren** per gebruiker (AVG), en een verwerkersovereenkomst-tekst voor syndici.

## 2. Boekhouding

- **Vereenvoudigde boekhouding voor kleine VME's** (W): nu altijd dubbel boekhouden. Onder 20 kavels mag een kasboek volstaan; een "eenvoudige modus" die dezelfde data toont als ontvangsten/uitgaven/kas/kapitaal.
- **Jaarrekening als document** (W): balans, resultatenrekening, afrekening per kavel en begroting als PDF genereren en automatisch in Documenten plaatsen bij afsluiting, zodat de AV ze kan goedkeuren en ze 7 jaar bewaard blijven.
- **Verslag van de commissaris**: gestructureerd formulier (gecontroleerde periode, bevindingen, advies aan de AV) dat als document en agendapunt verschijnt.
- **Betalingsherinneringen**: openstaande oproepen na de vervaldag automatisch aanmanen (eerste herinnering, aangetekende tweede), met kosten op 6166 en koppeling aan het dossier van de eigenaar.
- **Afrekening per boekjaar verzenden**: individuele afrekening als PDF per eigenaar met saldo en betaalinstructie.
- **Leveranciersbeheer**: adresboek met IBAN, btw-nummer en standaardrekening, zodat matching sterker wordt en facturen sneller geboekt zijn.
- **Btw**: VME's zijn meestal niet btw-plichtig, maar facturen bevatten btw; nu wordt het brutobedrag geboekt. Optioneel btw-detail bewaren voor rapportering.
- **Werkkapitaal-sleutel per kostensoort**: oproepen nu één sleutel per oproep; een oproep die meerdere sleutels combineert (bv. algemeen + lift) zou de afrekening exacter maken.
- **Periodieke boekingen**: terugkerende kosten (ereloon syndicus, verzekering) automatisch inplannen zoals afschrijvingen.
- **CODA met een echt bankbestand testen**; CSV-profielen per bank opslaan zodat de kolommapping maar één keer gebeurt.
- **Multi-valuta en leningen**: VME-leningen (klasse 17/42) met aflossingstabel.
- **Eigendomsoverdracht** (W, art. 3.94): bij verkoop van een kavel een "overdrachtsdossier" genereren met werk- en reservekapitaal, achterstallen, procedures en de laatste balans, binnen 15 dagen.

## 3. Algemene vergadering

- **Notulen opstellen in de app** (W, art. 3.87 §12): per agendapunt de beslissing, het aantal stemmen voor/tegen/onthouding en de namen van wie tegenstemde; notulen binnen 30 dagen verzenden aan alle stemgerechtigden en als document bewaren.
- **Stemmen tijdens de AV** op een scherm, met quorumberekening (helft eigenaars én helft aandelen, of 3/4 aandelen) en tweede oproeping na 15 dagen.
- **Volmachten registreren** (W): maximaal drie per drager, syndicus uitgesloten, gekoppeld aan de aanwezigheidslijst.
- **Schriftelijke besluitvorming** (W, art. 3.87 §11): eenparig schriftelijk beslissen buiten de AV om.
- **Bijeenroeping genereren**: uitnodiging met agenda en bijlagen als PDF, aangetekend of per e-mail volgens de keuze van elke eigenaar, met de 15-dagen-termijn bewaakt.
- **Verzoek tot AV door 1/5 van de aandelen**: knop voor eigenaars, automatische telling van aandelen, 30-dagen-teller voor de syndicus.

## 4. Documenten en communicatie

- **Voorvertoning** van PDF en afbeeldingen zonder download; **OCR** op facturen om bedrag, datum en leverancier voor te stellen bij het boeken.
- **Volledige tekst-zoeken** over documenten en berichten.
- **Postinterventiedossier en keuringsattesten** (W): aparte rubriek met vervaldata (lift, brand, EPC gemene delen) en herinneringen.
- **Onderhoudsplanning**: terugkerende taken (liftkeuring, schoorsteen) met leverancier, kosten en link naar de boekhouding.
- **Meldingen opvolgen als tickets**: toewijzen aan een leverancier, foto's toevoegen, status aan de melder terugkoppelen; nu enkel status en reacties.
- **Berichtvoorkeuren per type** (nu enkel push/e-mail aan of uit) en een digest-optie.
- **Franstalige en Engelstalige interface**: de locale staat in de database, de teksten zijn nog enkel Nederlands.

## 5. Leden en organen

- **Volledige eigenaarsgegevens**: adres, ondernemingsnummer, vruchtgebruik/naakte eigendom, meerdere eigenaars per kavel met stemafspraak (W: één stem per kavel bij onverdeeldheid).
- **Bewonersregister** (W, art. 3.89 §5 14°): lijst van wie recht heeft deel te nemen, voor de notaris en bij verkoop.
- **Eigendomsoverdracht uitvoeren**: oude eigenaar sluiten, nieuwe uitnodigen, saldo verrekenen.
- **Organen met meerdere syndici** (deelverenigingen) en **gebouwgroepen** voor grote complexen.

## 6. Platform en SaaS

- **Abonnementen en facturatie** per organisatie (Stripe), plan-limieten en een beheerdersportaal voor het syndicuskantoor over al zijn gebouwen (dashboard met openstaande meldingen, mandaten die aflopen, kas per gebouw).
- **Audit-export** en **versiegeschiedenis** van documenten (oude versies blijven nu overschreven in R2).
- **Tweestapsverificatie** voor syndici en passkeys.
- **Publieke API / webhooks** voor koppeling met boekhoudpakketten en banken (PSD2 via een aggregator zou CSV/CODA overbodig maken).
- **Offline-modus** in de PWA voor documenten die je gemarkeerd hebt.

## Volgorde die ik voorstel

1. Productierijp (rate limiting, e-maildomein, uploadvalidatie, tests).
2. Notulen, volmachten en quorum voor de AV: dit sluit de cirkel van agendapunt tot beslissing.
3. Jaarrekening en afrekening als PDF, commissarisverslag, betalingsherinneringen.
4. Vereenvoudigde boekhouding voor kleine VME's en het overdrachtsdossier bij verkoop.
5. Meertaligheid en het kantoorportaal.
