# Status och öppna manuella steg

Hålls uppdaterad av AI-assistenten. Vid sessionsstart ska assistenten påminna om allt under "Manuella steg" som inte är avbockat (se `.cursor/rules/session-status.mdc`).

## Manuella steg (kan inte göras av assistenten)

Behövs senast före steg 0.20 (riktig acceptans mot Google). Fråga alltid före deploy av functions eller regler.

- [x] M1. Projektet `calendar-38155` finns och är på Blaze (kontrollerat 2026-10-16). Kvar att kolla själv: att budgetlarm är satt.
- [x] M2. Registrera Web-appen och kopiera apiKey/authDomain/projectId/appId till `.env.local`.
- [x] M3 (bekräftat av dig 2026-10-16). Aktivera Auth med Google-leverantören (support-e-post).
- [x] M4 (kontrollerat 2026-10-16: databasen finns, `europe-west3`, native). Skapa Firestore-databasen (produktionsläge, `europe-west3`).
- [x] M5 (bekräftat av dig 2026-10-16). Aktivera Google Calendar API i samma Google Cloud-projekt.
- [x] M6 (bekräftat av dig 2026-10-16). OAuth consent screen (External), scope `https://www.googleapis.com/auth/calendar`, lägg till din e-post som testanvändare. I Testing-läge går refresh tokens ut efter 7 dagar. Sätt "In production" för långvarig personlig användning.
- [x] M7 (bekräftat av dig 2026-10-16. Client ID finns i .env.local och hör till rätt projekt. Origin och secret går inte att verifiera härifrån). Skapa en egen OAuth-klient (Web application) med authorized JS origin `http://localhost:5173` (hostingdomän senare). Client ID går i `VITE_GOOGLE_CLIENT_ID`. Secret används bara av Functions.
- [x] M8. `npx firebase-tools@latest login` och `firebase use <project-id>` (uppdatera `.firebaserc`, som idag pekar på `demo-spaces-calendar`).
- [ ] M9 (öppnad igen 2026-10-16). Vid test mot riktiga Google visade det sig att secrets hade fel värden: `GOOGLE_CLIENT_ID` innehöll ett inklistrat kommando (rättat av assistenten till Client ID från `.env.local`, version 2) och `GOOGLE_CLIENT_SECRET` innehåller Client ID i stället för Client secret. Kvar för dig: sätt `GOOGLE_CLIENT_SECRET` till den riktiga hemligheten (`GOCSPX-...`) med `npx firebase-tools functions:secrets:set GOOGLE_CLIENT_SECRET --project calendar-38155`. Vänta på frågan "Enter a value" och klistra in bara själva värdet. Sedan deployar assistenten om functions (med ditt ja).
- [x] M10. Skapa `.env.local` från `.env.example`.
- [x] M11. JDK 21 installerat (för emulatorerna).

## Fas 0 – läge

Klart: steg 0.1–0.19, och functions är deployade till `calendar-38155` (`googleConnect` och `googleAccessToken`, `europe-west3`, 2026-10-16, med städpolicy för containerbilder i Artifact Registry). Steg 0.19 är E2E (Playwright, `npm run e2e`, 7 tester): Auth-, Firestore- och Functions-emulatorerna körs på riktigt (`npm run emulators:e2e`, `functions/.env.demo-spaces-calendar`) och bara Google är låtsas: en token-server (`e2e/support/fakeGoogleServer.mjs`, port 9778, styrbar med `/__control/revoke|restore`), GIS-skriptet stubbas och Calendar API mockas med Playwrights `page.route` (`e2e/support/google.ts`). Täcker inloggning och omladdning, koppling, veckovy med kalenderfärger och kalendervalg, bläddring, återkallad åtkomst, "Koppla om" och ny koppling, delvis misslyckad hämtning och att bara en vecka hämtas. Kallstartsflaket är löst: `signIn` öppnar och stänger först en popup. Steg 0.18 är fellägen: fel i stället för tom vecka, redan hämtad data behålls med varningen "Kunde inte uppdatera", och `ErrorBoundary` ("Ladda om"). Steg 0.17b är kalendervalet (`CalendarPicker`, `useCalendarSelection`, sparas i localStorage per användare, standard Googles `selected`, "Återställ till Googles val"). Steg 0.17 är veckosidan (`WeekPage`: verktygsrad, kalenderlista, händelser, laddning och fel). Steg 0.16 är FullCalendar-adaptern (`src/features/calendar/adapter/`, v6 pinnat, tider i webbläsarens zon). Steg 0.15 är TanStack Query (`QueryProvider`, `createQueryClient`, hooks i `src/features/events/`, gräns på 6 samtidiga Google-anrop). Steg 0.14 är Google-klienten (src/lib/google/client.ts och calendar.ts): token, ett nytt försök vid 401, exponentiell backoff med jitter vid 429/5xx/rate limit-403/nätverksfel (Retry-After följs), paginering, listCalendars, listEvents och listEventsForCalendars (4 kalendrar åt gången, en trasig kalender stoppar inte de andra). Steg 0.13 är token i minnet (`src/lib/google/token.ts`), Google Identity Services (`gis.ts`), funktionsklienten (`src/lib/firebase/googleFunctions.ts`) och `src/features/google-access/` med "Koppla Google Calendar"/"Koppla om"-skärmar. Token glöms vid utloggning och byte av användare. Inte provat mot riktiga Google ännu (kräver deploy av functions och steg 0.20). Steg 0.12 är Cloud Functions `googleConnect` och `googleAccessToken` i `functions/` (35 enhetstester och 11 emulatortester via `npm run test:functions:emulator`, ännu inte deployade). Steg 0.1–0.11 är scaffold, lint, Tailwind/shadcn, tester, i18n, datum, färg, Google-scheman, Firebase init + regler och Google-inloggning med bestående session.

Kvar: 0.20 riktig acceptans: du testar mot ditt riktiga Google-konto (`npm run dev`, öppna http://localhost:5173, logga in, koppla, se veckan, ladda om, återkalla åtkomst och se "Koppla om"). Firestore-reglerna är inte deployade i den här sessionen och behövs inte för Fas 0:s flöden (klienten läser inget från Firestore ännu).

## Kända problem

- `npm audit`: 7 high från shadcn-CLI (inte åtgärdat med flit).
- Bundlen ger chunk-varning (1,2 MB, mest Firebase och FullCalendar). Code-splitting senare, t.ex. lazy-ladda veckovyn.
- PROJECT.md är otydlig om var `settings` ligger (`users/{uid}` eller `users/{uid}/settings/{doc}`). Reglerna tillåter båda.
- Dubbel frontmatter i `.cursor/rules/project.mdc`.
- Google Calendar API mockas i E2E med Playwrights page.route i stället för MSW (PROJECT.md nämner MSW). Samma effekt i webbläsaren utan service worker. Föreslå uppdatering av PROJECT.md om du vill behålla det som standard.
