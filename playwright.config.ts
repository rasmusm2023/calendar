import { defineConfig, devices } from '@playwright/test'

const PORT = 5173
const FUNCTIONS_EMULATOR_PORT = 5001
const FAKE_GOOGLE_PORT = 9778

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Auth-emulatorn delar tillstånd mellan testerna
  workers: 1,
  // Flöden med popup och emulator kan vara långsamma första gången efter kallstart.
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
    // Deterministiska tester: svenska och svensk tidszon, oavsett maskinens inställningar.
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Auth, Firestore och Functions (googleConnect/googleAccessToken) körs på riktigt i emulatorerna.
      // Bara Google själv är låtsas: token-servern nedan och Calendar API/GIS som mockas i testerna.
      command: 'npm run emulators:e2e',
      // Funktionen svarar 400 på GET när den är laddad (404 innan), så det här väntar på att den finns.
      url: `http://127.0.0.1:${String(FUNCTIONS_EMULATOR_PORT)}/demo-spaces-calendar/europe-west3/googleAccessToken`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Låtsas-Googles token-endpoint (functions/.env.demo-spaces-calendar pekar hit).
      command: 'node e2e/support/fakeGoogleServer.mjs',
      url: `http://127.0.0.1:${String(FAKE_GOOGLE_PORT)}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:emulator',
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
