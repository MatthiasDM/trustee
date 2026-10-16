# Continuïteit en vergissingen: uitzonderlijke scenario's

Wat als de mens achter een rol wegvalt, of iemand een fout maakt? Per scenario: wat de wet voorziet, wat Trustee vandaag doet, en wat we kunnen bouwen. Wetsverwijzingen zijn naar Boek 3 BW (zie `wetgeving.md`); punten met *(na te kijken)* zijn nog niet op Justel geverifieerd.

Leidraad voor alles hieronder: **de VME is van de mede-eigenaars, niet van de syndicus.** Elk scenario moet eindigen met "en de mede-eigenaars kunnen verder", nooit met "en dan zit alles vast achter één account".

## A. Mensen vallen weg

### A1. De syndicus (de persoon) is langdurig ziek, afwezig of overleden

| | |
|---|---|
| Wet | Bij verhindering of in gebreke blijven kan **elke mede-eigenaar** de vrederechter vragen een **voorlopige syndicus** aan te stellen (art. 3.89 §1). De syndicus mag zijn bevoegdheden enkel overdragen met toestemming van de AV, beperkt in duur of doel (art. 3.89 *(§ na te kijken)*). Mede-eigenaars met 1/5 van de aandelen kunnen een AV eisen; roept niemand op, dan mag een van hen zelf (art. 3.87 §2). |
| Vandaag | Bij een **kantoor** (org) hebben alle kantoormedewerkers syndicusrechten op alle gebouwen: een collega neemt gewoon over. Bij **zelfbeheer** (één persoon met rol syndicus) zit alles vast: niemand anders kan leden beheren, vergaderingen plannen of boeken. De raad en commissaris hebben wel inzage, dus niets gaat verloren. |
| Gebouwd (16 okt 2026) | Mandaat *Voorlopig syndicus* met rechtsgrond (§6/§7/§8) en bewijsstuk geeft syndicusrechten zolang het loopt. Verstrijkt de termijn van 30 dagen na een 1/5-verzoek, dan mag elke ondertekenaar zelf bijeenroepen en de vergadering volledig beheren. Zonder syndicus: raad, voorzitter laatste AV of 1/5-ondertekenaars roepen bijeen om een syndicus aan te wijzen en registreren het nieuwe mandaat. |
| Voorstel (rest) | 1) **Plaatsvervanger** (`deputy`): de syndicus wijst vooraf een vervanger aan (collega of mede-eigenaar). Die krijgt pas syndicusrechten als de plaatsvervanging geactiveerd wordt, en elke actie wordt gelogd als "namens". Activeren kan de syndicus zelf, of de raad na X dagen inactiviteit. 2) **Noodprocedure via de raad**: als de syndicus Y dagen niet inlogt én dringende zaken open staan (vervallen keuring, onbetaalde factuur, AV-termijn), krijgt de raad een melding met de wettelijke opties (voorlopige syndicus vragen, AV eisen) en een knop om zelf een AV bijeen te roepen. 3) **Overdrachtsdossier syndicus**: één knop die alle beheersdocumenten, boekhouding en lopende zaken exporteert voor een opvolger (art. 3.89 §? verplicht de uittredende syndicus alles binnen 30 dagen over te dragen *(na te kijken)*). |

### A2. De syndicus wordt ontslagen, neemt ontslag of zijn mandaat verloopt

| | |
|---|---|
| Wet | De AV kan de syndicus altijd ontslaan; mandaat max. 3 jaar, alleen uitdrukkelijk hernieuwbaar (art. 3.89). Overdracht van het dossier aan de opvolger. |
| Vandaag | Mandaten worden bijgehouden met vervalherinneringen (cron). Een lid met rol syndicus kan door een andere syndicus verwijderd worden, maar een syndicus die als enige overblijft kan zichzelf niet "overdragen" aan een opvolger zonder dat die eerst uitgenodigd is. |
| Voorstel | Wizard **"Syndicus wisselen"**: nodig opvolger uit → opvolger accepteert → oude syndicus wordt *gewezen syndicus* (leesrecht op zijn periode, geen schrijfrecht) → overdrachtsdossier automatisch in Documenten. Verlopen mandaat zonder hernieuwing: schrijfrechten blijven (dagelijks beheer moet door), maar een banner voor raad en AV dat het mandaat verlopen is en de AV moet beslissen. |

### A3. Een raadslid of de commissaris valt weg

| | |
|---|---|
| Wet | Raad verplicht vanaf 20 kavels; commissaris jaarlijks door de AV benoemd (art. 3.90, 3.91). Tussentijds vervangen gebeurt op de volgende AV. |
| Vandaag | Mandaat eindigt; rol kan door de syndicus aangepast worden. Geen controle dat de raad nog bestaat of de commissaris nog actief is. |
| Voorstel | Melding aan syndicus en raad als een verplicht orgaan onbezet raakt, met automatisch agendapunt "Benoeming commissaris/raadslid" voor de volgende AV. Commissarisverslag dat nog in ontwerp staat bij vertrek: markeren als "onafgewerkt, opvolger benoemen". |

### A4. Een mede-eigenaar overlijdt, verkoopt, of is onbereikbaar

| | |
|---|---|
| Wet | Overdrachtsdossier bij verkoop (art. 3.94); de nieuwe eigenaar wordt van rechtswege lid. Erfgenamen zijn in onverdeeldheid; één vertegenwoordiger stemt *(art. 3.87 §? na te kijken)*. |
| Vandaag | Kavels kunnen overgezet worden naar een andere eigenaar; overdrachtsdossier bestaat. Geen "onverdeeldheid" of vertegenwoordiger. Oproepen blijven naar het oude e-mailadres gaan. |
| Voorstel | Kavelstatus **"in overdracht / nalatenschap"** met contactpersoon (notaris, erfgenaam) en datum. Oproepen en herinneringen naar die contactpersoon; stemgewicht blijft op de kavel maar wordt bij quorum apart getoond. Terugkerende bounce van e-mails markeert een lid als "onbereikbaar" en meldt dit aan de syndicus (roadmap: vruchtgebruik/onverdeeldheid). |

### A5. Het syndicuskantoor stopt of gaat failliet

| | |
|---|---|
| Wet | De VME blijft eigenaar van haar gegevens en documenten; de AV benoemt een nieuwe syndicus. |
| Vandaag | Gebouwen hangen onder een org. Als niemand van de org nog inlogt, kan niemand het gebouw aan een andere org hangen. Superadmin (platformbeheer) kan het wel. |
| Voorstel | Elk gebouw krijgt een **"eigenaarsexit"**: de raad (of bij gebrek, een AV-beslissing geüpload als document) kan via platformbeheer het gebouw losmaken van het kantoor en overdragen. Jaarlijkse automatische export (zip met documenten, boekhouding, notulen) naar de raad, zodat de VME nooit afhankelijk is van het kantoor of van Trustee zelf. |

### A6. Iemand verliest zijn toegang (wachtwoord, telefoon, e-mail)

| | |
|---|---|
| Vandaag | Wachtwoord vergeten werkt via e-mail. Verlies van het e-mailadres zelf: niets. |
| Voorstel | Syndicus kan het e-mailadres van een lid wijzigen na identiteitscontrole, met melding naar het oude én nieuwe adres en een log. Voor de syndicus zelf: tweede contact (plaatsvervanger uit A1) of platformbeheer. Als 2FA komt (roadmap): herstelcodes bij activatie. |

## B. Vergissingen

Algemeen principe: **niets echt verwijderen, alles terugdraaibaar, en wie verwittigd werd krijgt ook de correctie.** De boekhouding doet dit al goed (boekingen zijn onveranderlijk, correctie via tegenboeking). De rest van het platform nog niet overal.

### B1. Vergadering per ongeluk gepland of met foute datum

| | |
|---|---|
| Vandaag | Bij aanmaken worden alle leden verwittigd (push, e-mail, .ics). Wijzigen of verwijderen kan, maar **zonder bericht**: leden houden de foute datum in hun agenda. Agendapunten en volmachten blijven aan een verwijderde vergadering hangen (worden ontkoppeld). |
| Voorstel | **Annuleren** in plaats van verwijderen: status `cancelled` met reden, verplicht bericht aan iedereen en een .ics-update (METHOD:CANCEL). Bij datumwijziging: bericht + nieuwe .ics, en de wettelijke oproepingstermijn van 15 dagen opnieuw bewaken (anders waarschuwing "tweede oproeping nodig"). Gegeven volmachten en RSVP's blijven staan bij verplaatsing, worden gewist bij annulering. Oproeping pas verplicht verzenden bij een expliciete knop "Oproepen" in plaats van direct bij het aanmaken (concept-vergadering). |

### B2. Stemming per ongeluk geopend, foute opties of foute meerderheid

| | |
|---|---|
| Vandaag | Concept-status bestaat. Een open stemming kan gesloten of verwijderd worden; opties en meerderheid kunnen niet meer wijzigen zodra er stemmen zijn. Verwijderen wist uitgebrachte stemmen zonder spoor. |
| Voorstel | **Intrekken** met reden: stemming blijft zichtbaar als "ingetrokken", stemmen blijven bewaard, iedereen die al stemde krijgt bericht. Wijzigen van opties of meerderheid: enkel als nog niemand stemde, anders intrekken en opnieuw openen (automatisch "versie 2" met link naar de ingetrokken). |

### B3. Document verkeerd geplaatst, verkeerde zichtbaarheid, verkeerde kavel

| | |
|---|---|
| Vandaag | Verwijderen is definitief (R2-object weg). Zichtbaarheid wijzigen kan. Wie het al opende, blijft onbekend behalve bij "enkel syndicus"-stukken (kennisgeving). |
| Voorstel | **Prullenbak** (30 dagen `deleted_at`, enkel syndicus ziet en herstelt). Documentgeschiedenis (roadmap: versies). Bij een te ruim gedeeld privé-stuk: log tonen wie het opende, zodat de syndicus weet wie te verwittigen. |

### B4. Foute boeking, foute afrekening, foute oproep of herinnering verstuurd

| | |
|---|---|
| Vandaag | Boekingen: tegenboeking met spoor. Afrekeningen/jaarrekening: opnieuw genereren maakt een nieuwe versie. Herinneringen: eenmaal verstuurd is verstuurd. |
| Voorstel | Herinneringen en oproepen eerst als **voorbeeld per kavel** tonen vóór verzending (nu al deels), met een knop "Rectificatie sturen" die naar dezelfde ontvangers een correctie stuurt die verwijst naar de foute brief. Automatische herinneringen pauzeren zodra een kavel status "betwist" of "in overdracht" krijgt. |

### B5. Verkeerd lid verwijderd, verkeerde rol, verkeerde kavel gekoppeld

| | |
|---|---|
| Vandaag | Verwijderen van een lid wist het lidmaatschap; bijdragen, stemmen en berichten blijven (op user_id). Terugzetten = opnieuw uitnodigen. Rol wijzigen is direct, zonder bevestiging. |
| Voorstel | Lidmaatschap deactiveren in plaats van wissen (`left_at`), herstelbaar. Bevestiging met gevolgen ("dit lid is commissaris met lopend mandaat") vóór rolwijziging of verwijdering. Nooit de **laatste syndicus** van een gebouw laten verwijderen of degraderen zonder opvolger. |

### B6. Notulen definitief gemaakt met een fout

| | |
|---|---|
| Wet | Notulen zijn binnen 30 dagen te bezorgen; een correctie gebeurt door een **erratum** of goedkeuring op de volgende AV, niet door stil herschrijven. |
| Vandaag | Definitief = onveranderlijk PDF. |
| Voorstel | Knop **"Erratum"**: nieuwe versie met zichtbare wijziging, beide bewaard, opnieuw verzonden. Beslissingenregister verwijst naar de laatste versie. |

### B7. Verkeerde persoon uitgenodigd (vreemd e-mailadres)

| | |
|---|---|
| Vandaag | Uitnodiging 14 dagen geldig; kan ingetrokken worden zolang niet geaccepteerd. Eenmaal geaccepteerd is het een gewoon lid. |
| Voorstel | Eigenaarsuitnodigingen koppelen aan een kavel en pas stemrecht geven na bevestiging van de syndicus dat de identiteit klopt (bv. na de eerste AV of een notarisbrief). |

## C. Conflict en misbruik

### C1. De syndicus werkt niet mee of werkt tegen (geen AV, geen inzage, geen stukken)

| | |
|---|---|
| Wet | 1/5-verzoek met 30 dagen (art. 3.87 §2); inzagerecht van elke mede-eigenaar; raad en commissaris met inzage; vrederechter. |
| Vandaag | 1/5-verzoek met termijn en melding; wie na de termijn zelf mag oproepen staat in de handleiding, maar de knop "Vergadering plannen" is enkel voor syndicus/raad. |
| Voorstel | Na het verstrijken van de 30 dagen krijgen de ondertekenaars zelf een knop om de AV te plannen en op te roepen (wettelijk toegestaan). Wat de syndicus niet mag: leden verwijderen die hem lastig vallen zonder spoor → elke verwijdering wordt aan de raad gemeld. |

### C2. Verdachte of gecompromitteerde syndicusaccount (phishing, gestolen laptop)

| | |
|---|---|
| Vandaag | Sessies 30 dagen; rate limiting; audit-log voor syndicus, raad en commissaris; geen 2FA. |
| Voorstel | 2FA verplicht voor syndicus en kantoorleden (roadmap). "Alle sessies afmelden" voor de gebruiker zelf en voor de syndicus op een lid. Gevoelige acties (bankrekening wijzigen, massale verwijdering, export van alle gegevens) extra bevestigen en aan de raad melden. Bankrekeningnummer van de VME alleen wijzigbaar met een tweede bevestiging na 24 uur. |

### C3. Belangenconflict (syndicus laat zijn eigen firma werken)

| | |
|---|---|
| Wet | Voorafgaande toestemming van de AV voor overeenkomsten met de syndicus, zijn naasten of verbonden vennootschappen (art. 3.89). |
| Voorstel | Leveranciersfiche met vinkje "verbonden met de syndicus"; boekingen op zo'n leverancier vereisen een gekoppelde AV-beslissing, anders een waarschuwing in het dagboek en bij de commissaris. |

## D. Platform en techniek

### D1. Trustee zelf is onbereikbaar (Cloudflare-storing, bug, factuur niet betaald)

| | |
|---|---|
| Vandaag | Maandelijkse back-up naar R2 (JSON + documenten), enkel door platformbeheer te herstellen. PWA cachet de laatste schermen. |
| Voorstel | **Zelfbedieningsexport** voor de syndicus én de raad: zip met alle documenten, boekhouding (CSV + PDF-jaarrekening), notulen, ledenlijst. Jaarlijks automatisch in Documenten geplaatst, zodat de VME haar archief altijd zelf heeft. Status-pagina; e-mails gaan via Resend ook door als de app plat ligt (cron staat op Cloudflare zelf, dus die niet). |

### D2. Gegevens per ongeluk massaal gewist (migratiefout, bug)

| | |
|---|---|
| Vandaag | D1 heeft **Time Travel** (point-in-time herstel tot 30 dagen) voor de hele database, niet per gebouw. R2 heeft geen prullenbak. |
| Voorstel | Soft-delete overal (B3, B5), R2-objecten pas fysiek wissen na 30 dagen, en back-upfrequentie van maandelijks naar dagelijks voor de databasedump. |

### D3. E-mail of push komt niet aan (spam, verlopen push-abonnement)

| | |
|---|---|
| Wet | Oproeping per aangetekende brief tenzij de mede-eigenaar schriftelijk met een ander kanaal instemde (art. 3.87 §3 *(na te kijken)*); dit geldt voor de oproeping en de notulen. |
| Vandaag | Melding altijd in-app; e-mail wordt gelogd maar niet-bezorging wordt niet opgevolgd. Geen registratie van instemming met elektronische communicatie. |
| Voorstel | Per lid vastleggen "akkoord met elektronische oproeping (datum)"; zonder akkoord toont de oproepingslijst "aangetekend versturen" voor dat lid. Bounces van Resend verwerken (webhook) → lid "onbereikbaar". Leesbevestiging van oproepingen voor het dossier. |

### D4. Cron draait niet (herinneringen, afschrijvingen, mandaatmeldingen blijven uit)

| | |
|---|---|
| Vandaag | Laatste cronstatus in KV; niemand kijkt ernaar. |
| Voorstel | Kantoorportaal toont "laatste automatische run"; bij meer dan 48 uur stilte een melding aan platformbeheer en inhaalrun bij de volgende start. Alles in de cron is idempotent (nu al grotendeels: boeken van afschrijvingen controleert op dubbels). |

## E. Overgangen en randgevallen

- **Nieuw gebouw zonder syndicus** (oplevering): de promotor beheert tot de eerste AV. Rol "voorlopig beheerder" met dezelfde rechten als syndicus maar een einddatum = eerste AV.
- **Gebouw onder 20 kavels zonder raad**: toezichtfuncties van de raad (A1, C1) vallen dan toe aan "elke mede-eigenaar"; meldingen die naar de raad gaan, gaan naar alle eigenaars.
- **Syndicus is zelf mede-eigenaar** (zelfbeheer): nu correct gemodelleerd (kavel = stemrecht, nooit volmacht dragen). Belangenconflict-regel (C3) ook toepassen op zijn eigen kavel bij geschillen over achterstallen.
- **Twee syndici tegelijk** (overgangsmaand): mandaatdata overlappen; toestaan met waarschuwing, en in de audit-log zichtbaar wie wat deed.
- **Verkeerd gebouw**: kantoor boekt een factuur op het verkeerde gebouw. Tegenboeking + nieuwe boeking werkt, maar een "verplaats naar gebouw X" voor documenten en boekingen zou sneller zijn.

## Prioriteiten (voorstel)

Wat het meeste risico wegneemt voor de minste bouw:

1. **Annuleren en rectificeren in plaats van verwijderen** (B1, B2, B6): statusveld + verplicht bericht + .ics-cancel. Klein, en het sluit het gat dat je nu al ziet.
2. **Prullenbak en soft-delete** (B3, B5, D2): `deleted_at` op documenten en lidmaatschappen, R2 uitgesteld wissen, laatste syndicus beschermd.
3. **Plaatsvervanger en noodprocedure** (A1, A2, C1): deputy-rol, inactiviteitsmelding aan de raad, ondertekenaars mogen na 30 dagen zelf oproepen, wizard syndicuswissel met overdrachtsdossier.
4. **Zelfbedieningsexport** (A5, D1): de VME bezit haar archief, altijd, buiten Trustee en buiten het kantoor om.
5. **Elektronische-communicatie-akkoord en bounces** (D3): juridisch nodig voor geldige oproepingen.
6. **2FA en sessiebeheer** (C2).

## F. Randgevallen uit de wettekst zelf (nagelezen 16 oktober 2026)

Wat Boek 3 BW nog regelt en Trustee vandaag niet of maar half afdekt. Volgorde = voorgestelde prioriteit.

| # | Bepaling | Wat de wet zegt | Trustee vandaag | Wat te bouwen |
|---|---|---|---|---|
| F1 (gebouwd 16/10) | art. 3.87 §1, lid 2: vruchtgebruik, onverdeeldheid, erfpacht, opstal | Bij gesplitste eigendom is het deelnamerecht **geschorst** tot de belanghebbenden één lasthebber aanwijzen; die wordt opgeroepen en ontvangt alle documenten. | Meerdere eigenaars per kavel met share_pct; elk stemt afzonderlijk. | Per kavel een *lasthebber*; zonder lasthebber: oproeping wel, stemmen en volmacht geven niet; quorum toont de kavel als "geschorst". |
| F2 (gebouwd 16/10) | art. 3.87 §8, lid 2: stemplafond | Niemand mag stemmen voor meer stemmen dan alle andere aanwezigen samen, ook niet als lasthebber. | Niet toegepast. | Bij het registreren van de AV-stemming: aandelen van één persoon (eigen + volmachten) aftoppen op het totaal van de anderen; melding in de notulen. |
| F3 (gebouwd 16/10) | art. 3.87 §9: belangenconflict | Wie voor de VME werkt (lasthebber, personeel, leverancier) stemt niet mee over zijn eigen opdracht, ook niet bij volmacht. | Niets. | Agendapunt koppelen aan een leverancier of lid; die wordt bij dat punt uitgesloten van stemming en volmacht; de syndicus-eigenaar valt hier ook onder voor zijn eigen contract. |
| F4 | art. 3.89 §5, 6°: bewoners zonder stemrecht | Huurders en andere bewoners krijgen de **datum** van elke AV en mogen vooraf schriftelijk vragen stellen die aan de vergadering worden meegedeeld. | Huurders krijgen de oproeping "ter info"; vragen via Vragen & meldingen. | Bij elke AV een knop "Vraag voor de AV" voor huurders; die vragen komen als bijlage bij de agenda en in de notulen. |
| F5 | art. 3.87 §12: notulen niet ontvangen | Wie de notulen niet binnen 30 dagen kreeg, meldt dat schriftelijk aan de syndicus. | Notulen gaan naar iedereen; geen ontvangstbevestiging. | Leesbevestiging per lid; na 30 dagen lijst "niet geopend" voor de syndicus en een knop "Niet ontvangen" voor het lid. |
| F6 (gebouwd 16/10) | art. 3.92 §3 en art. 3.93: vernietiging | Elke mede-eigenaar kan binnen **4 maanden** na de AV de vrederechter om vernietiging vragen; bewoners zonder stemrecht binnen 2 maanden na kennisgeving. | Termijn vermeld in de notulenmelding. | Bij elke beslissing in het register: datum AV, vervaldag van de termijn, status "definitief" na 4 maanden; link naar de procedure. |
| F7 (gebouwd 16/10) | art. 3.92 §1 (3.88 §1, 2°, h): afbraak en heropbouw | Zonder eenparigheid moet de VME zelf binnen 4 maanden naar de vrederechter; uitvoering geschorst tot vonnis. | Meerderheid 4/5 kan gekozen worden, zonder opvolging. | Waarschuwing bij dat type agendapunt met de termijn, en een taak voor de syndicus. |
| F8 (gebouwd 16/10) | art. 3.94 §5 en 3.95: verkoop | Werkkapitaal wordt afgerekend en terugbetaald aan de verkoper en opgevraagd bij de koper; reservekapitaal blijft van de VME; notaris meldt de akte binnen 30 dagen; achterstallen volgen vaste regels. | Overdrachtsdossier (PDF); kavel overzetten. | Overdrachtsafrekening die het werkkapitaal pro rata splitst en de oproep aan de koper aanmaakt; veld "akte verleden op" met notaris. |
| F9 | art. 3.86 §3: reservekapitaal | Verplicht na 5 jaar na voorlopige oplevering (minimum per jaar), tenzij 4/5 anders beslist; aparte rekeningen voor werk- en reservekapitaal. | Twee fondsen en twee bankrekeningen. | Datum voorlopige oplevering op het gebouw; herinnering na 5 jaar; controle dat er een reservefonds-oproep per jaar is. |
| F10 | art. 3.89 §9: syndicus geen raadslid | De syndicus mag in dezelfde VME niet tegelijk lid van de raad zijn. | Mandaten en rollen onafhankelijk. | Blokkeren bij het registreren van een raadsmandaat voor de (voorlopige) syndicus en omgekeerd. |
| F11 (gebouwd 16/10) | art. 3.92 §5: dringende werken via de rechter | Haalt de AV de meerderheid niet, dan kan elke mede-eigenaar de rechter toestemming vragen voor dringende en noodzakelijke werken op kosten van de VME. | Niets. | Bij een verworpen punt over werken: verwijzing naar deze mogelijkheid in de handleiding en in het resultaat. |
| F12 | art. 3.82: nutsinfrastructuur in gemene delen | Een mede-eigenaar mag op eigen kosten kabels of leidingen aanleggen na kennisgeving twee maanden vooraf; de anderen kunnen gemotiveerd verzet aantekenen. | Niets. | Melding van het type "werken art. 3.82" met de termijn van twee maanden en een verzetsknop voor de organen. |
| F13 | art. 3.84 §3 en 3.86: deelverenigingen | Vanaf 20 kavels kunnen deelverenigingen met eigen organen bestaan. | Niet ondersteund (roadmap). | Gebouw met deelverenigingen als sub-VME's met eigen kavels, organen en boekhouding. |
| F14 | art. 3.97: ontbinding en vereffening | Bij ontbinding wordt een vereffenaar aangesteld en vereffend. | Niets. | Status "in vereffening" op het gebouw: alleen lezen, export, vereffenaar met syndicusrechten. |
| F15 | art. 3.89 §5, 4°: aangetekende post aan de VME | Aangetekende brieven aan de VME gaan naar de woonplaats of zetel van de syndicus én de zetel van de VME. | Adres van het gebouw. | Zetel van de VME en correspondentieadres van de syndicus apart op de gebouwfiche, in de voettekst van brieven. |

Productrandgevallen zonder wetsartikel: een VME met twee eigenaars (elk besluit is eenparig of blokkeert), een eigenaar die alle kavels bezit (geen VME meer), meerdere syndici tegelijk (de wet spreekt van "de andere syndici"), kavels zonder aandelen (quotiteiten nul), statuten die afwijken van de wettelijke AV-periode, en een gebouw dat van kantoor verandert midden in een boekjaar.
