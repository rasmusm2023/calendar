import { defineConfig, devices } from '@playwright/test'

const PORT = 5173
const AUTH_EMULATOR_PORT = 9099

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
      // Bara Auth-emulatorn behövs för E2E i Fas 0 (Google-API:et mockas).
      command: 'npx firebase emulators:start --only auth --project demo-spaces-calendar',
      url: `http://127.0.0.1:${String(AUTH_EMULATOR_PORT)}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:emulator',
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
