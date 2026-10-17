import { expect, test, type Page } from '@playwright/test'
import { eventBlock, openCalendar } from './support/app.ts'
import { clearAuthAccounts } from './support/auth.ts'
import { fakeGoogle, zonedTime, type FakeCalendar } from './support/google.ts'

const CALENDARS: FakeCalendar[] = [
  { id: 'work', name: 'Jobb', color: '#e11d48', selected: true, primary: true },
]

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
  await fakeGoogle.reset(request)
})

async function openWeek(page: Page) {
  await page.clock.setFixedTime(new Date(zonedTime(0, '10:00')))
  await openCalendar(page, {
    calendars: CALENDARS,
    events: {
      work: [
        {
          id: 'w1',
          title: 'Planering',
          start: zonedTime(0, '09:00'),
          end: zonedTime(0, '10:00'),
        },
        {
          id: 's1',
          title: 'Veckomöte',
          start: zonedTime(-14, '15:00'),
          end: zonedTime(-14, '16:00'),
          recurrence: ['RRULE:FREQ=WEEKLY'],
          timeZone: 'Europe/Stockholm',
        },
      ],
    },
  })
  await expect(eventBlock(page, 'Planering')).toBeVisible()
}

function viewButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'Vy' }).getByRole('button', { name, exact: true })
}

test('D, W, M, A, N, T, J och K styr vyn', async ({ page }) => {
  await openWeek(page)
  const title = page.getByTestId('calendar-title')
  const weekTitle = await title.innerText()

  await page.keyboard.press('d')
  await expect(viewButton(page, 'Dag')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('w')
  await expect(viewButton(page, 'Vecka')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('n')
  await expect(viewButton(page, '3 dagar')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('m')
  await expect(viewButton(page, 'Månad')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('a')
  await expect(viewButton(page, 'Schema')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('w')

  await page.keyboard.press('j')
  await expect(title).not.toHaveText(weekTitle)
  await page.keyboard.press('k')
  await expect(title).toHaveText(weekTitle)
  await page.keyboard.press('ArrowRight')
  await expect(title).not.toHaveText(weekTitle)
  await page.keyboard.press('t')
  await expect(title).toHaveText(weekTitle)
})

test('? visar kortkommandona', async ({ page }) => {
  await openWeek(page)

  await page.keyboard.press('?')

  const dialog = page.getByRole('dialog', { name: 'Kortkommandon' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Ctrl+Z')).toBeVisible()
  await expect(dialog.getByText('Ctrl+Shift+Z eller Ctrl+Y')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('Delete och Ctrl+D gäller den valda händelsen utan att den har fokus', async ({ page }) => {
  await openWeek(page)
  const planning = eventBlock(page, 'Planering')

  await planning.click()
  await expect(page.getByTestId('event-edit')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('event-edit')).toBeHidden()
  await expect(planning).toBeFocused()

  await page.getByRole('button', { name: 'Idag' }).focus()
  await expect(planning).toHaveClass(/sc-selected/)
  await page.keyboard.press('Control+d')
  await expect(eventBlock(page, 'Planering')).toHaveCount(2)

  await page.keyboard.press('Delete')
  await expect(eventBlock(page, 'Planering')).toHaveCount(1)
})

test('Ctrl+Z ångrar och Ctrl+Shift+Z gör om', async ({ page }) => {
  await openWeek(page)

  await eventBlock(page, 'Planering').click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Idag' }).focus()
  await page.keyboard.press('Delete')
  await expect(eventBlock(page, 'Planering')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(eventBlock(page, 'Planering')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect(eventBlock(page, 'Planering')).toHaveCount(0)
})

test('avbruten fråga om återkommande händelse lämnar fokus på händelsen', async ({ page }) => {
  await openWeek(page)
  const meeting = eventBlock(page, 'Veckomöte')

  await meeting.focus()
  await page.keyboard.press('Delete')
  const dialog = page.getByRole('dialog', { name: 'Ta bort återkommande händelse' })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(meeting).toBeFocused()
  await expect(meeting).toBeVisible()
})
