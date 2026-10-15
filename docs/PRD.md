PRD – Kalender (arbetsnamn: "Spaces Calendar")
Produktkravdokument. Beskriver vad som ska byggas och varför. Teknisk arkitektur och kodregler finns i ./PROJECT.md.

1. Sammanfattning
   En webbaserad kalenderapp som är ett eget, bättre gränssnitt ovanpå Google Calendar. Google Calendar är källan för alla händelser och sköter aviseringarna (push till mobil, e-post). Appen lägger till det Google saknar:

Spaces: separata arbetsytor (t.ex. Work, Personal, Skola) som går att växla mellan direkt, plus en samlad vy över flera eller alla spaces.
Familjer och färgsystem: händelser grupperas i familjer (t.ex. "Träning", "Ekonomi"). Ändrar man en familjs färg ändras alla dess händelser direkt, även återkommande och historiska.
Tydligare vyer: fyllda färgblock även för tidsbestämda händelser i månadsvyn, egna dagintervall och bättre överblick.
Snabb redigering: drag & drop, kortkommandon, kommandopalett och snabbinmatning. Varje ändring går att ångra.
Grundprincip: UI och UX måste fungera felfritt. Allt som känns sämre än Google Calendar, som hackig drag & drop, långsam synk eller förlorade ändringar, gör appen meningslös. Kvalitet går före antal funktioner.

2. Problem med Google Calendar som vi löser
   Problem i Google Calendar Vår lösning
   Tidsbestämda händelser blir en liten prick i månadsvyn Fyllda färgblock i alla vyer (valbart)
   Händelser kan bara få 11 fasta färger Valfri färg (hex) per familj, med automatisk textkontrast
   Går inte att ändra färg på "alla gympass" på en gång Familjer: ändra en gång, alla händelser uppdateras
   Ingen separation mellan jobb och privat utöver att dölja kalendrar en och en Spaces med kortkommandon och en samlad vy
   "Viktigt" måste lösas med en egen kalender Markering Viktig som egenskap på händelsen, oberoende av familj
   Svårt att se veckans balans Valfri summering per familj (timmar per vecka)
   Begränsade kortkommandon och ingen kommandopalett Ctrl/Cmd+K-palett, fullt tangentbordsstöd
   Ångra fungerar inte för alla åtgärder Ångra/gör om för alla ändringar
3. Målgrupp och personas
   Primär: en person (byggaren själv) som planerar skola, träning, sysslor, ekonomi och privatliv i Google Calendar och vill ha bättre överblick och snabbare planering.
   Sekundär (senare): andra Google Calendar-användare som vill ha samma sak.
   Persona: "Planeraren". Planerar veckan på söndagar och använder time blocking. Vill se med en blick hur veckan är fördelad. Använder mobilen för aviseringar (via Google Calendar-appen) och datorn för planering.

4. Mål och icke-mål
   Mål (v1)
   Ersätta Google Calendar på datorn för daglig planering.
   All data lagras i Google så att Google Calendar-appen på mobilen fortsätter fungera, inklusive aviseringar.
   Spaces och familjer fungerar fullt ut.
   Drag & drop och skapa/flytta/ändra längd fungerar med samma eller bättre känsla än i Google Calendar.
   Icke-mål (v1)
   Eget aviseringssystem (Google sköter aviseringarna).
   Native mobilapp. Webbappen ska vara användbar på mobil, men den är inte primär.
   Delning och samarbete, eller att boka möten med andra utöver Googles vanliga inbjudningar.
   Flera Google-konton samtidigt (planeras till v2, men datamodellen ska stödja det redan nu).
   Todoist-integration (v3).
5. Begrepp
   Begrepp Definition
   Händelse (Event) En Google Calendar-händelse. Lagras i Google.
   Kalender En Google-kalender (t.ex. "Skola", "Gymma/träna").
   Space En arbetsyta som består av en uppsättning kalendrar, familjer och vyinställningar. En kalender tillhör högst ett space.
   Samlad vy (All) Visar händelser från valda eller alla spaces samtidigt.
   Familj (Family) En visuell och logisk grupp av händelser med färg, ikon och standardpåminnelser. Kan omfatta en hel kalender eller en del av den.
   Familjeregel En regel som automatiskt placerar händelser i en familj, t.ex. "titeln innehåller gym".
   Viktig En flagga på en enskild händelse som ger visuell betoning, oberoende av familj.
6. Funktionella krav
   Prioritet: P0 = måste finnas i v1, P1 = bör finnas i v1, P2 = senare.

6.1 Inloggning och Google-koppling
P0 Logga in med Google (Firebase Auth).
P0 Ge åtkomst till Google Calendar (OAuth, scope calendar eller calendar.events + calendar.readonly). Åtkomsten ska bestå mellan sessioner utan nya inloggningar (refresh token hanteras på servern, se PROJECT.md).
P0 Tydligt felläge om åtkomsten återkallats, med en knapp för att koppla om.
P0 Kalendervalg (fas 0): användaren väljer vilka av sina Google-kalendrar som visas, även flera samtidigt (t.ex. jobb och privat i samma vy för att se krockar). Valet sparas lokalt per användare, standard är Googles `selected: true`. Det är en föregångare till spaces och samlad vy (fas 2) och ersätts av dem då.
P1 Onboarding: vid första inloggning importeras alla kalendrar. En familj skapas per kalender (med kalenderns färg), och användaren får ett förslag på spaces som går att justera.
Acceptanskriterier

Användaren ska inte behöva logga in igen inom 30 dagar vid normal användning.
Användaren förlorar aldrig data på grund av utgången token. Ändringar som görs medan token förnyas köas och skickas därefter.
6.2 Vyer
P0 Dag, vecka (mån–sön), månad och schema/agenda.
P0 Egen vy med N dagar (2–14).
P0 Månadsvyn: valet "Fyllda block för tidsbestämda händelser" (standard: på).
P0 Linje för "nu" i dag- och veckovy, och automatisk scroll till aktuell tid.
P0 Veckan börjar på måndag och 24-timmarsformat är standard. Båda går att ändra.
P1 Veckonummer.
P1 Ställbar zoom av tidsaxeln (t.ex. 15/30/60 min per rad), även med Ctrl+scroll.
P1 Dölj helger och begränsa synliga timmar (t.ex. 07–23).
P2 Årsvy (heatmap per familj).
6.3 Händelser: skapa, redigera, ta bort
P0 Skapa genom att klicka eller dra i rutnätet. En snabbpopover öppnas med titel, tid, familj och kalender.
P0 Fullständig redigeringspanel: titel, tid, heldag, upprepning, plats, beskrivning, kalender, familj, påminnelser och Viktig.
P0 Återkommande händelser: valet "Bara denna / Denna och följande / Alla" vid ändring och borttagning.
P0 Ta bort med Delete/Backspace och ångra via toast.
P0 Duplicera (Ctrl/Cmd+D, eller Alt+dra).
P1 Snabbinmatning med naturligt språk, svenska och engelska, t.ex. Gym imorgon 17-18 #träning ! → titel "Gym", i morgon 17:00–18:00, familj Träning, markerad Viktig.
P1 Flytta en händelse till en annan kalender (Googles move).
6.4 Drag & drop (kritisk kvalitet)
P0 Flytta en händelse inom en dag och mellan dagar.
P0 Ändra längd genom att dra i nederkanten. Ändra starttid genom att dra i överkanten.
P0 Dra mellan heldagsraden och tidsrutnätet. Det konverterar mellan heldag och tidsbestämd händelse (standardlängd 1 h).
P0 Snäpp till 15 min. Håll Alt för 5 min och Shift för att stänga av snäppningen.
P0 Spöke eller förhandsvisning visar exakt ny tid under dragningen.
P0 Optimistisk uppdatering: ändringen syns direkt, synkas i bakgrunden och rullas tillbaka med ett tydligt felmeddelande om Google svarar med fel.
P0 Esc avbryter en pågående dragning.
P0 Fungerar med mus, styrplatta och touch.
P1 Flera markerade händelser (Shift/Ctrl+klick, eller lasso) kan flyttas tillsammans.
P1 Tangentbordsalternativ: markera en händelse och flytta den med piltangenter (↑↓ = 15 min, ←→ = en dag).
P1 Autoscroll när man drar mot kanten av rutnätet.
Acceptanskriterier

Dragning håller 60 fps med 200 synliga händelser.
Från släpp till uppdaterad position i UI: < 16 ms (optimistiskt).
Ingen "hopp-tillbaka-och-fram" (flicker) när serverns svar kommer.
Snabba upprepade ändringar av samma händelse slås ihop eller köas så att den sista ändringen alltid vinner.
6.5 Spaces
P0 Skapa, byta namn på, sortera och ta bort spaces. Varje space har namn, ikon/emoji och accentfärg.
P0 Tilldela kalendrar till spaces. En kalender kan bara tillhöra ett space. Kalendrar utan space hamnar under "Otilldelade".
P0 Växla space via sidomenyn och med Ctrl/Cmd+1…9.
P0 Samlad vy: "Alla spaces" (Ctrl/Cmd+0) och valfri kombination av spaces via flerval.
P0 I den samlade vyn visas vilket space varje händelse tillhör (en diskret markering i spacets accentfärg), och man kan filtrera snabbt.
P0 Varje space har en standardkalender för nya händelser.
P1 Varje space minns sin senaste vy (t.ex. Work = vecka, Personal = månad).
P1 Separata standardpåminnelser per space.
P2 Space kopplat till ett eget Google-konto (multi-account).
P2 Schemalagt automatiskt byte (t.ex. Work vardagar 08–17).
6.6 Familjer och färgsystem
P0 Skapa och redigera familjer med namn, färg (fri hex), ikon (valfri) och tillhörande space.
P0 Ändra familjens färg → alla händelser i familjen byter färg direkt. Färgen räknas ut när händelsen visas och lagras inte per händelse.
P0 Familjetillhörighet bestäms i denna ordning, och den första som matchar gäller:
Explicit val på händelsen (sparas i Googles extendedProperties.private).
Familjeregler i användarens prioritetsordning (titel innehåller/börjar med/regex, kalender, plats).
Kalenderns standardfamilj.
Ingen familj, vilket ger kalenderns färg.
P0 Högerklick på händelse → "Byt färg på hela familjen 'Träning'" och "Flytta till familj…".
P0 Textfärgen väljs automatiskt (svart eller vit) för att klara WCAG AA-kontrast.
P0 Färgväljaren har förinställda paletter som är harmoniska och tillgänglighetstestade, en fri hex-väljare och live-förhandsvisning i kalendern innan man sparar.
P1 Massändring: markera flera familjer → ändra ton, mättnad eller ljushet tillsammans, eller välj en färdig palett.
P1 Visningsstil per familj: fylld, ljus fyllning med färgad kant eller kontur.
P1 Synk till Google: familjens färg mappas till närmaste av Googles 11 colorId och skrivs till händelsen, så att mobilappen visar en liknande färg. Valbart per familj.
P1 Standardpåminnelser per familj (t.ex. Träning: 30 min före). Gäller nya händelser, med en knapp för att "tillämpa på befintliga kommande".
P1 Regelförhandsvisning: medan man skriver en regel visas hur många och vilka händelser som matchar.
P2 Tema- och palettexport och import.
6.7 "Viktig"
P0 Flagga på händelse (lagras i extendedProperties.private), växlas med kortkommandot I eller via kontextmenyn.
P0 Visas som tydlig betoning (t.ex. tjockare kant och ikon), oberoende av familjefärg.
P1 Filtret "Visa bara viktiga".
6.8 Påminnelser och aviseringar
P0 Påminnelser sätts på händelsen i Google (reminders.overrides, popup och/eller email). Själva aviseringen levereras av Google till mobil och dator.
P0 UI för att lägga till, ta bort och ändra påminnelser med snabbval (5, 10, 15, 30 min, 1 h, 1 dag).
P0 Standardordning: familjens standard → spacets standard → Googles kalenderstandard.
P1 Webbläsaraviseringar i appen när den är öppen, som komplement. Aldrig som enda kanal.
6.9 Effektivitet
P0 Kommandopalett (Ctrl/Cmd+K): sök händelser, byt space, byt vy, skapa händelse, öppna familjeinställningar och utför alla åtgärder.
P0 Kortkommandon (visas med ?): D/W/M/A vy, T idag, J/K eller ←/→ nästa/föregående period, C skapa, E redigera, Del ta bort, I viktig, Ctrl+Z / Ctrl+Shift+Z ångra/gör om, Ctrl+1…9 space, / sök.
P0 Ångra/gör om för alla mutationer: skapa, flytta, ändra längd, redigera, ta bort, byta familj och färgändringar.
P1 Sök i titel, beskrivning och plats, med filter för space, familj och datumintervall.
P1 Summering per familj och vecka (timmar), visas i sidopanelen.
6.10 Uppgifter (P2, fas 3)
Google Tasks visas i kalendern och kan kopplas till en familj och ett space (kopplingen lagras i appens egen databas, eftersom Google Tasks saknar färger).
Dra en uppgift till rutnätet för att skapa ett tidsblock.
Senare: Todoist-integration.
6.11 Inställningar
P0 Ljust/mörkt/system-tema.
P0 Tidszon (standard: webbläsarens), veckostart och tidsformat.
P0 Språk: svenska och engelska.
P1 Täthet: kompakt eller bekväm. 7. UX-principer
Direkt respons. Allt sker optimistiskt, och synken syns bara när något gått fel.
Inget kan förstöras. Allt går att ångra, och destruktiva massändringar visar förhandsvisning och bekräftelse.
Enkel ytan, kraftfull under. Nybörjaren ska klara sig med högerklick och färgväljare. Den erfarna användaren ska kunna göra allt med tangentbordet.
Förhandsvisa före bekräftelse. Färg-, regel- och massändringar visas live innan de sparas.
Konsekvens med Google där det redan fungerar. Samma grundlogik för dra/klick/återkommande, så att inlärningen blir minimal.
Tillgänglighet. Fullt tangentbordsstöd, synligt fokus, ARIA-roller i rutnätet, WCAG AA-kontrast och respekt för prefers-reduced-motion. 8. Icke-funktionella krav
Område Krav
Prestanda Första laddning < 2 s (cachad < 1 s). Vybyte < 100 ms. Dragning 60 fps.
Synk Ändringar från Google (t.ex. gjorda i mobilen) syns inom 60 s när appen är aktiv, och direkt vid fönsterfokus. v1: hämtning per synligt datumintervall + polling. Push via events.watch utreds i fas 3.
Offline Senast hämtade data går att läsa offline (cache i IndexedDB). Ändringar offline köas (P1).
Tillförlitlighet Ingen ändring får tyst gå förlorad. Misslyckade ändringar visas och kan försökas igen.
Säkerhet Refresh tokens lagras bara på servern och kan aldrig läsas av klienten. Firestore-regler begränsar all data till ägaren.
Integritet Händelsedata lagras inte i Firestore, bara metadata (spaces, familjer, regler, inställningar).
Tillgänglighet WCAG 2.2 AA.
Webbläsare Senaste Chrome, Edge, Firefox och Safari. Mobil-Safari och Chrome ska fungera för läsning och enklare redigering. 9. Mätetal för framgång
Användaren använder appen i stället för Google Calendar på datorn i 4 veckor i rad.
0 rapporterade fall av förlorade eller dubblerade händelser.
Under 1 % av drag-operationerna rullas tillbaka på grund av fel.
Att byta färg på en hel familj tar under 10 sekunder från idé till klart. 10. Faser och milstolpar
Fas 0: Grund Projektuppsättning, auth + Google-koppling, kalenderlista och läsning av händelser i veckovyn.

Fas 1: Kärnkalender (MVP) Alla vyer, skapa/redigera/ta bort, drag & drop (P0), återkommande händelser, påminnelser, ångra, synk (intervallhämtning + polling).

Fas 2: Spaces och familjer Spaces med växling och samlad vy, familjer, regler, färgsystem, Viktig, kontextmenyer, kommandopalett och onboarding.

Fas 3: Förfining P1-krav: massändring av färger, Google-färgsynk, snabbinmatning, summering, multi-select, offlineköer och Google Tasks.

Fas 4: v2 Flera Google-konton, Todoist och schemalagt byte av space.

Varje fas avslutas först när dess acceptanskriterier är uppfyllda och E2E-testerna för fasen är gröna.

11. Risker och öppna frågor
    Risk Hantering
    OAuth-appen i läget "Testing" ger refresh tokens som går ut efter 7 dagar För personligt bruk: sätt appen till "In production" (overifierad, max 100 användare, varningsskärm vid inloggning). Inför publik lansering: Googles verifiering av känsliga scopes.
    Drag & drop-kvaliteten räcker inte Använd ett beprövat kalenderbibliotek (FullCalendar) bakom ett adapterlager. Bygg E2E-tester för drag tidigt.
    Återkommande händelser är komplexa Låt Google expandera instanser (singleEvents=true). Använd Googles API för undantag. Testa "denna och följande" särskilt.
    API-kvoter Inkrementell synk, batchning, cache och exponentiell backoff.
    Familjefärg syns inte i Googles mobilapp Valbar mappning till närmaste Google colorId (6.6, P1).
    Öppna frågor

Ska en händelse kunna tillhöra flera familjer? (Förslag: nej, en familj plus valfria taggar senare.)
Ska spaces kunna dela en kalender? (Förslag: nej i v1. Använd familjer för att dela upp en kalender.)
