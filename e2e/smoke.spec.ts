import { expect, test } from '@playwright/test'

test('appen laddas och visar inloggning för en utloggad användare', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toBeVisible()
  await expect(page.getByTestId('app-root')).toHaveCount(0)
})
