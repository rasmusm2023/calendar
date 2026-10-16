import { expect, test } from '@playwright/test'
import { clearAuthAccounts, signIn, signInViaEmulatorPopup } from './support/auth.ts'

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
})

test('logga in med Google, förbli inloggad efter omladdning och logga ut', async ({ page }) => {
  await signIn(page)

  // Inloggad men Google Calendar är inte kopplat än, så kopplingsskärmen visas (med "Logga ut").
  await expect(page.getByRole('button', { name: 'Logga ut' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toHaveCount(0)

  // Sessionen består: ingen ny inloggning efter omladdning.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Logga ut' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toHaveCount(0)

  // Utloggning ger tillbaka inloggningsskärmen, även efter omladdning.
  await page.getByRole('button', { name: 'Logga ut' }).click()
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toBeVisible()
})

test('stängs inloggningsfönstret visas inget fel och det går att försöka igen', async ({
  page,
}) => {
  await page.goto('/')
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Logga in med Google' }).click()
  const popup = await popupPromise
  await popup.close()

  // Knappen är aldrig låst, så man kan försöka igen direkt (Firebase märker stängningen först efter
  // några sekunder men avbryter då det gamla försöket tyst).
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toBeEnabled()
  await expect(page.getByText('Inloggningen misslyckades')).toHaveCount(0)

  await signInViaEmulatorPopup(page)
  await expect(page.getByRole('button', { name: 'Logga ut' })).toBeVisible()
  await expect(page.getByText('Inloggningen misslyckades')).toHaveCount(0)
})
