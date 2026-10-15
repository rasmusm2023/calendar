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
- [x] M9 (2026-10-16: båda secrets har aktiverad version 1. Att paret stämmer ihop prövas först i steg 0.20). `npx firebase-tools functions:secrets:set GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET`. Du skriver värdena själv, assistenten ska aldrig se dem. För emulatorn: `functions/.secret.local`.
- [x] M10. Skapa `.env.local` från `.env.example`.
- [x] M11. JDK 21 installerat (för emulatorerna).

## Fas 0 – läge

Klart: steg 0.1–0.11 (scaffold, lint, Tailwind/shadcn, tester, i18n, datum, färg, Google-scheman, Firebase init + regler, Google-inloggning med bestående session).

Kvar: 0.12 Cloud Functions, 0.13 token + GIS, 0.14 Google-klient, 0.15 TanStack Query, 0.16 FullCalendar-adapter, 0.17 veckosida, 0.17b kalendervalg, 0.18 fellägen ("Koppla om"), 0.19 E2E, 0.20 riktig acceptans.

## Kända problem

- E2E `e2e/auth.spec.ts`, första testet är `test.fixme`. Vid kallstart av Auth-emulatorn lyckas inte inloggningspopupen koppla tillbaka till sidan. Utredning: emulatorns iframe (`/emulator/auth/iframe`) skapas först vid klick och dess `https://apis.google.com/js/api.js` blir aldrig klar medan popupen är öppen (även med `route.fetch`, och nätverket är OK enligt curl). Testet "popup stängs, försök igen" går igenom eftersom iframen hinner laddas när popupen stängts. `networkidle` hjälper inte. Nästa idé: i hjälpfunktionen, öppna och stäng popupen först, vänta tills iframen är `complete`, klicka sedan igen.
- `npm audit`: 7 high från shadcn-CLI (inte åtgärdat med flit).
- Firebase-bundlen ger chunk-varning (code-splitting senare).
- PROJECT.md är otydlig om var `settings` ligger (`users/{uid}` eller `users/{uid}/settings/{doc}`). Reglerna tillåter båda.
- Dubbel frontmatter i `.cursor/rules/project.mdc`.
- Utloggning bör rensa Google-token i minnet (steg 0.13).
