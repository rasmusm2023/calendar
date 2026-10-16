import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const AUTH_EMULATOR = 'http://127.0.0.1:9099'
export const PROJECT_ID = 'demo-spaces-calendar'

/** Rensar konton i Auth-emulatorn så att varje test startar utloggat och rent. */
export async function clearAuthAccounts(request: APIRequestContext) {
  await request.delete(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`)
}

/** Loggar in via Auth-emulatorns Google-popup (fejkad Google-inloggning). `readyMarker` syns när appen är inloggad. */
export async function signInViaEmulatorPopup(page: Page) {
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Logga in med Google' }).click()
  const popup = await popupPromise
  // Emulatorns popup är inte byggd för tillgänglighetsträdet, så här används textväljare.
  await popup.waitForLoadState('load')
  const autoGenerate = popup.getByText(/auto-generate user information/i)
  // Klicket kan komma innan popupens skript kopplat sina händelsehanterare, så försök tills formuläret syns.
  await expect(async () => {
    await popup.getByText(/add new account/i).click({ timeout: 1_000 })
    await expect(autoGenerate).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  await autoGenerate.click()
  // Samma sak här: popupens skript laddas från internet, så första klicket efter kallstart kan vara
  // verkningslöst. Klicka om tills popupen stängt sig själv, vilket den gör vid lyckad inloggning.
  const signInButton = popup.locator('button').filter({ hasText: /^\s*Sign in with/ })
  await expect(async () => {
    if (!popup.isClosed()) {
      await signInButton.click({ timeout: 1_000 })
    }
    await expect(page.getByRole('button', { name: 'Logga in med Google' })).toHaveCount(0, {
      timeout: 2_000,
    })
  }).toPass({ timeout: 20_000 })
}

/**
 * Loggar in som en ny användare. Det första popup-försöket efter kallstart av emulatorn lyckas inte
 * (popupen blir hängande), så vi öppnar och stänger en popup först. Då "värms" emulatorns sida upp och
 * den riktiga inloggningen går igenom (se docs/STATUS.md, Kända problem).
 */
export async function signIn(page: Page) {
  await page.goto('/')
  const warmUp = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Logga in med Google' }).click()
  await (await warmUp).close()
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toBeEnabled()
  await signInViaEmulatorPopup(page)
}
