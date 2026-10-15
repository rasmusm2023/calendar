Projektbeskrivning – Spaces Calendar
Teknisk beskrivning: arkitektur, stack, datamodell och kodkonventioner. Produktkraven finns i ./PRD.md. Vid konflikt gäller PRD för vad och detta dokument för hur.

1. Översikt
   En React/TypeScript-webbapp som är ett eget gränssnitt ovanpå Google Calendar.

Google Calendar API är källan för alla händelser, kalendrar och påminnelser. Google levererar aviseringarna.
Firebase sköter inloggning (Auth), appens egen metadata (Firestore: spaces, familjer, regler, inställningar), serverlogik för OAuth-tokens (Cloud Functions) och hosting.
Händelsedata lagras aldrig i Firestore. Det enda som lagras per händelse ligger i Googles extendedProperties.private (familj och Viktig).
┌──────────────────────── Webbläsare ────────────────────────┐
│ React UI ── TanStack Query ── googleClient (fetch + token) │──► Google Calendar API
│ │ │
│ └── Zustand (UI-state, ångra-stack) │
│ └── Firestore SDK (spaces, familjer, inställningar) │──► Firestore
└───────────────┬────────────────────────────────────────────┘
│ callable functions (Firebase ID token)
▼
Cloud Functions ── refresh token (Firestore, bara serveråtkomst)
│
▼
Google OAuth token endpoint 2. Teknikstack
Del Val Varför
Bygg Vite + React 19 + TypeScript (strict) Snabb utveckling, standard
Styling Tailwind CSS v4 + CSS-variabler för teman Tema och familjefärger via variabler
UI-primitiver shadcn/ui (Radix) Tillgängliga popovers, dialoger, menyer
Kalenderrutnät + DnD FullCalendar v6 (@fullcalendar/react, daygrid, timegrid, interaction, list) – MIT Beprövad drag/resize/select, hantering av överlapp, eventDisplay: 'block' ger fyllda block i månadsvyn
Serverdata TanStack Query v5 (+ persist till IndexedDB) Cache, optimistiska mutationer, refetch vid fokus
UI-state Zustand Aktivt space, vy, markering, ångra-stack
Datum date-fns v4 + @date-fns/tz Tidszoner, veckostart måndag
Validering zod Validera Google-svar och Firestore-dokument
Kommandopalett cmdk Ctrl/Cmd+K
Kortkommandon react-hotkeys-hook
Färger culori OKLCH-manipulation, kontrast, närmaste Google-färg
i18n i18next + react-i18next sv/en
Backend Firebase: Auth, Firestore, Cloud Functions (v2, Node 20+), Hosting
Test Vitest + Testing Library, Playwright (E2E), MSW (mocka Google API)
Kodkvalitet ESLint (typescript-eslint, react-hooks), Prettier
FullCalendar används bakom ett adapterlager (src/features/calendar/adapter/). Resten av appen arbetar bara med våra egna typer (CalEvent), så att biblioteket kan bytas utan att resten påverkas.

3. Auth och Google-åtkomst
   Firebase Auth ger identiteten, men ingen långlivad åtkomst till Google Calendar. Därför används ett separat OAuth-kodflöde:

Inloggning: signInWithPopup(GoogleAuthProvider) → Firebase uid.
Koppla Google Calendar: Google Identity Services initCodeClient({ client_id, scope, ux_mode: 'popup', access_type: 'offline', prompt: 'consent' }) → engångskod.
Kodbyte (Cloud Function googleConnect, callable): verifierar Firebase-användaren och byter koden mot access_token + refresh_token (redirect_uri: 'postmessage'). Refresh token sparas i users/{uid}/private/google. Klienten kan aldrig läsa den dokumentet (se Firestore-regler).
Hämta access token (Cloud Function googleAccessToken, callable): returnerar en ny access_token + expiresAt. Klienten håller den endast i minnet och förnyar den ca 5 min innan den går ut, samt vid 401.
API-anrop görs direkt från webbläsaren till https://www.googleapis.com/calendar/v3/... med Authorization: Bearer.
Återkallad åtkomst (invalid_grant) → funktionen returnerar en felkod och UI visar "Koppla om Google Calendar".
Scopes: https://www.googleapis.com/auth/calendar (läs/skriv händelser och kalenderlista). Senare för uppgifter: .../auth/tasks.

Secrets: GOOGLE*CLIENT_SECRET via firebase functions:secrets:set. Får aldrig ligga i klientkod eller i .env som börjar med VITE*.

4. Datamodell
   4.1 Google (källan)
   Kalendrar: calendarList.list. Färg från backgroundColor (hämtas med colorRgbFormat=true).
   Händelser: events.list med singleEvents=true, timeMin/timeMax för synligt intervall (± en period för förhämtning).
   Appens egna fält på händelser (extendedProperties.private):
   scFamilyId: explicit familj (valfri)
   scImportant: "1" om Viktig
   Påminnelser: reminders: { useDefault, overrides: [{ method: 'popup' | 'email', minutes }] }.
   4.2 Firestore (appens metadata)
   users/{uid}
   settings (doc) { theme, locale, timeZone, weekStartsOn, timeFormat,
   monthFilledBlocks, density, activeSpaceIds: string[] }
   spaces/{spaceId} { name, icon, accentColor, order, defaultCalendarId,
   defaultReminders: Reminder[], lastView }
   calendarPrefs/{calId} { spaceId | null, defaultFamilyId | null, hidden, accountId }
   families/{familyId} { name, color /_hex_/, icon?, spaceId, style: 'filled'|'tinted'|'outline',
   defaultReminders?: Reminder[], syncGoogleColor: boolean, order }
   familyRules/{ruleId} { familyId, order, enabled,
   match: { field: 'title'|'location'|'calendar',
   op: 'contains'|'startsWith'|'equals'|'regex',
   value: string, caseSensitive: boolean } }
   private/google { refreshToken, scope, connectedAt } ← bara Cloud Functions
   accountId på calendarPrefs finns för framtida stöd för flera konton (v2). I v1 är värdet alltid "primary".
   Alla dokument valideras med zod-scheman i src/lib/firebase/schemas.ts.
   4.3 Firestore-regler (princip)
   Firestore kombinerar överlappande match-regler med OR. En bred regel som `match /users/{uid}/{document=**}` ger därför ägaren åtkomst även till `private/google` (refresh token), och en separat `allow ...: if false` hjälper inte. Matcha i stället bara de tillåtna samlingarna uttryckligen och lämna `private` helt utan match (allt som inte matchas nekas). Cloud Functions når `private/google` via Admin SDK, som går förbi reglerna.
   match /users/{uid} { allow read, write: if request.auth.uid == uid; }
   match /users/{uid}/settings/{doc} { allow read, write: if request.auth.uid == uid; }
   (samma regel för spaces, calendarPrefs, families och familyRules; ingen match för private)
   Se firestore.rules och firestore-tests/ (regeltesterna bevisar bland annat att klienten nekas åtkomst till private/google).
5. Kärnlogik
   5.1 Familjetillhörighet och stil (ren funktion)
   resolveFamily(event, ctx) → familyId | null, i den här ordningen:

event.extendedProperties.private.scFamilyId (om familjen finns)
Första matchande aktiva regel enligt order
calendarPrefs[event.calendarId].defaultFamilyId
null
resolveEventStyle(event, ctx) → { bg, border, text, style, important }. Familjens färg, annars kalenderns färg. Textfärgen räknas ut för WCAG AA-kontrast. Funktionen memoizeras per (event.id, event.etag, familiesVersion).

Färger lagras aldrig per händelse i appen. En färgändring på en familj ändrar bara familjedokumentet, och alla vyer ritas om. Detta är grunden för "byt färg på alla" (PRD 6.6).

5.2 Google-färgsynk (P1)
Om family.syncGoogleColor är på hittar man närmaste colorId (från colors.get, avstånd i OKLab) och skriver det till händelser i familjen, som en bakgrundsjobb-kö med batchning och backoff.

5.3 Mutationer, optimism och ångra
Alla ändringar går via kommandon i src/lib/undo/: { label, apply(): Promise, revert(): Promise, optimistic(cache), rollback(cache) }.
Flöde: optimistic → UI uppdateras direkt → apply mot Google → vid fel: rollback + toast med "Försök igen".
Ångra kör revert som ett nytt kommando (gör om = apply igen).
Serialisering per händelse: mutationer på samma eventId köas. Senaste ändringen vinner, och mellanliggande ändringar som inte startat slås ihop.
Konflikter: skicka If-Match: etag vid PATCH. Vid 412 hämtas händelsen igen och användaren informeras.
5.4 Återkommande händelser
Vi visar instanser (singleEvents=true) och expanderar aldrig RRULE själva.
Bara denna: PATCH på instansens id.
Alla: PATCH på recurringEventId (mastern). Tidsförskjutning appliceras relativt.
Denna och följande: sätt UNTIL på masterns RRULE till dagen före och skapa en ny serie från instansen. Kapslas som ett enda ångra-kommando.
5.5 Synk
TanStack Query-nycklar: ['events', calendarId, rangeStart, rangeEnd].
refetchOnWindowFocus: true och refetchInterval: 60_000 när fliken är synlig.
Förhämta föregående och nästa period när användaren byter vy.
Cache sparas i IndexedDB för snabb start och läsning offline.
Exponentiell backoff på 403 (rate limit) och 5xx.
5.6 Spaces
Synliga kalendrar = calendarPrefs där spaceId ∈ settings.activeSpaceIds och !hidden.
"Alla spaces" = alla spaceIds plus otilldelade.
Byte av space ändrar bara activeSpaceIds (optimistiskt i Zustand, sparas med debounce till Firestore). 6. Mappstruktur
/
├─ docs/ PRD.md, PROJECT.md
├─ .cursor/rules/ Cursor-regler
├─ src/
│ ├─ app/ providers, router, layout, theme
│ ├─ components/ui/ shadcn-komponenter (genererade)
│ ├─ features/
│ │ ├─ auth/ inloggning, Google-koppling, token-hantering
│ │ ├─ calendar/ vyer, toolbar, adapter/ (FullCalendar), dnd
│ │ ├─ events/ editor, snabbpopover, quick-add, hooks (queries/mutations)
│ │ ├─ spaces/ sidomeny, växlare, inställningar
│ │ ├─ families/ familjer, regelmotor, färgväljare, massändring
│ │ ├─ command-palette/
│ │ └─ settings/
│ ├─ lib/
│ │ ├─ google/ client.ts (fetch + token + retry), calendar.ts, types.ts, colors.ts
│ │ ├─ firebase/ init, schemas.ts, repos (spaces, families …)
│ │ ├─ undo/ kommando-mönster, stack
│ │ ├─ color/ kontrast, OKLCH, paletter
│ │ └─ dates/ tz-hjälpare, intervall
│ ├─ i18n/ sv.json, en.json
│ └─ types/ domäntyper (CalEvent, Family, Space …)
├─ functions/ Cloud Functions (googleConnect, googleAccessToken)
├─ e2e/ Playwright-tester (dra, ändra längd, återkommande, spaces)
├─ firestore.rules
└─ firebase.json 7. Kodkonventioner
TypeScript strict. Ingen any. Data från Google och Firestore valideras med zod vid gränsen.
Funktionsbaserad struktur. En feature exporterar sitt publika API via index.ts.
All Google-kommunikation går via src/lib/google/. Inga fetch direkt mot Google någon annanstans.
Alla mutationer går via undo-kommandon (5.3). Inga direkta useMutation mot Google i komponenter.
FullCalendar importeras bara i features/calendar/adapter/.
Datum: lagra och skicka ISO-strängar med tidszon. Räkna med date-fns och @date-fns/tz. Aldrig new Date(string) utan tidszon.
Färger: komponenter får stilen från resolveEventStyle. Inga hårdkodade hex-värden i komponenter, bara Tailwind-tokens och CSS-variabler.
Tillgänglighet: interaktiva element ska gå att nå med tangentbordet och ha synligt fokus. Använd Radix-primitiver för menyer och dialoger.
Texter i UI: alltid via i18n-nycklar.
Tester:
Enhetstester för regelmotor, resolveEventStyle, färg/kontrast, ångra-stack och logiken för återkommande ändringar.
E2E (Playwright + MSW) för: skapa genom att dra, flytta mellan dagar, ändra längd, heldag ↔ tid, avbryta med Esc, ångra, rollback vid API-fel, byte av space och byte av familjefärg.
Commits: små och fokuserade, och appen ska bygga och testerna vara gröna efter varje commit. 8. Uppsättning (en gång)
Skapa ett Firebase-projekt (Blaze-plan krävs för Cloud Functions; gratisnivån räcker för personligt bruk).
I samma Google Cloud-projekt: aktivera Google Calendar API.
OAuth-samtyckesskärm: extern, lägg till scopes och din egen e-post som testanvändare.
OBS: i läget "Testing" går refresh tokens ut efter 7 dagar. För långvarig personlig användning: växla till "In production" (overifierad app, varning vid inloggning, max 100 användare).
OAuth-klient (Web): auktoriserade JS-origins http://localhost:5173 + hosting-domänen.
Aktivera Google-inloggning i Firebase Auth.
Miljövariabler:
Klient (.env.local): VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID, VITE_GOOGLE_CLIENT_ID
Functions (secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
Lokalt: Firebase Emulator Suite för Auth, Firestore och Functions. 9. Definition of Done (per funktion)
Uppfyller acceptanskriterierna i PRD.
Fungerar med tangentbord, i ljust och mörkt tema samt på sv och en.
Optimistisk uppdatering, felhantering med rollback och ångra är implementerade.
Enhets- och/eller E2E-test finns och är grönt.
Inga TypeScript- eller ESLint-fel.
