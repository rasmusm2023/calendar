import { expect, test } from '@playwright/test'

test('appen laddas och renderar rotelementet', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-root')).toBeAttached()
})
