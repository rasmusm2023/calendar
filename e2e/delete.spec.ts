import { expect, test, type Page } from '@playwright/test'
import { eventBlock, openCalendar, pointAt } from './support/app.ts'
import { clearAuthAccounts } from './support/auth.ts'
import {
  fakeGoogle,
  zonedTime,
  type CalendarApiMock,
  type FakeCalendar,
  type FakeEvent,
} from './support/google.ts'

const CALENDARS: FakeCalendar[] = [
  { id: 'work', name: 'Jobb', color: '#e11d48', selected: true, primary: true },
  { id: 'readonly', name: 'Helgdagar', color: '#16a34a', selected: true, accessRole: 'reader' },
]

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
  await fakeGoogle.reset(request)
})

/** Öppnar veckan med klockan fast på 10:00. */
async function openWeek(page: Page, setup?: (api: CalendarApiMock) => void) {
  await page.clock.setFixedTime(new Date(zonedTime(0, '10:00')))
  const api = await openCalendar(
    page,
    {
      calendars: CALENDARS,
      events: {
        work: [
          {
            id: 'w1',
            title: 'Planering',
            start: zonedTime(0, '09:00'),
            end: zonedTime(0, '10:00'),
            location: 'Rum 4',
            description: 'Ta med kaffe',
            reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] },
          },
          {
            id: 'w3',
            title: 'Veckomöte',
            start: zonedTime(-14, '15:00'),
            end: zonedTime(-14, '16:00'),
            recurrence: ['RRULE:FREQ=WEEKLY'],
            timeZone: 'Europe/Stockholm',
          },
        ],
        readonly: [
          {
            id: 'r1',
            title: 'Nationaldag',
            start: zonedTime(0, '17:00'),
            end: zonedTime(0, '18:00'),
          },
        ],
      },
    },
    setup,
  )
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  return api
}

function titlesIn(api: CalendarApiMock, calendarId: string): string[] {
  return api.events[calendarId].map((event) => event.title)
}

function findByTitle(api: CalendarApiMock, title: string): FakeEvent[] {
  return api.events.work.filter((event) => event.title === title)
}

const deletes = (api: CalendarApiMock) => api.writeRequests.filter((w) => w.method === 'DELETE')
const posts = (api: CalendarApiMock) => api.writeRequests.filter((w) => w.method === 'POST')

test('Delete på en fokuserad händelse tar bort den direkt och hos Google', async ({ page }) => {
  const api = await openWeek(page)

  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Delete')

  await expect(eventBlock(page, 'Planering')).toHaveCount(0)
  await expect.poll(() => deletes(api).length).toBe(1)
  expect(deletes(api)[0]?.path).toBe('/calendars/work/events/w1')
  expect(titlesIn(api, 'work')).not.toContain('Planering')
  await expect(page.getByRole('button', { name: 'Ångra' })).toBeVisible()
})

test('Backspace tar också bort', async ({ page }) => {
  const api = await openWeek(page)

  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Backspace')

  await expect(eventBlock(page, 'Planering')).toHaveCount(0)
  await expect.poll(() => deletes(api).length).toBe(1)
})

test('ångra tar tillbaka händelsen med allt innehåll (som en ny händelse)', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Delete')
  await expect.poll(() => deletes(api).length).toBe(1)

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Planering')).toBeVisible()
  await expect(eventBlock(page, 'Planering')).toContainText('09:00')
  await expect.poll(() => posts(api).length).toBe(1)
  expect(posts(api)[0]?.body).toMatchObject({
    summary: 'Planering',
    location: 'Rum 4',
    description: 'Ta med kaffe',
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] },
  })
  // Google tillåter inte att ett borttaget id används igen.
  expect((posts(api)[0]?.body as { id: string }).id).not.toBe('w1')
  const [restored] = findByTitle(api, 'Planering')
  expect(restored).toMatchObject({
    start: zonedTime(0, '09:00'),
    end: zonedTime(0, '10:00'),
    location: 'Rum 4',
    description: 'Ta med kaffe',
  })
})

test('Ta bort i redigeringspanelen', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await page.getByRole('dialog').getByRole('button', { name: 'Ta bort', exact: true }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(eventBlock(page, 'Planering')).toHaveCount(0)
  await expect.poll(() => deletes(api).length).toBe(1)
})

test('misslyckad borttagning visar händelsen igen och erbjuder att försöka igen', async ({
  page,
}) => {
  const api = await openWeek(page, (mock) => {
    mock.failWrites = { status: 500, reason: 'backendError' }
  })
  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Delete')

  await expect(page.getByText('Kunde inte spara: Ta bort Planering')).toBeVisible()
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  expect(titlesIn(api, 'work')).toContain('Planering')

  api.failWrites = null
  await page.getByRole('button', { name: 'Försök igen' }).click()
  await expect(eventBlock(page, 'Planering')).toHaveCount(0)
  await expect.poll(() => titlesIn(api, 'work')).not.toContain('Planering')
})

test('Ctrl+D duplicerar den fokuserade händelsen med allt innehåll', async ({ page }) => {
  const api = await openWeek(page)

  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Control+d')

  await expect(eventBlock(page, 'Planering')).toHaveCount(2)
  await expect.poll(() => posts(api).length).toBe(1)
  expect(posts(api)[0]?.body).toMatchObject({
    summary: 'Planering',
    location: 'Rum 4',
    description: 'Ta med kaffe',
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] },
    start: { dateTime: zonedTime(0, '09:00') },
    end: { dateTime: zonedTime(0, '10:00') },
  })
  expect(findByTitle(api, 'Planering')).toHaveLength(2)
  // Originalet är orört.
  expect(deletes(api)).toHaveLength(0)
  expect(api.writeRequests.filter((w) => w.method === 'PATCH')).toHaveLength(0)
})

test('ångra av en duplicering tar bort kopian men lämnar originalet', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Control+d')
  await expect(eventBlock(page, 'Planering')).toHaveCount(2)
  await expect.poll(() => posts(api).length).toBe(1)

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Planering')).toHaveCount(1)
  await expect.poll(() => deletes(api).length).toBe(1)
  expect(findByTitle(api, 'Planering').map((event) => event.id)).toEqual(['w1'])
})

test('Duplicera i redigeringspanelen', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await page.getByRole('dialog').getByRole('button', { name: 'Duplicera' }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(eventBlock(page, 'Planering')).toHaveCount(2)
  await expect.poll(() => posts(api).length).toBe(1)
})

test('Alt+dra lämnar originalet och lägger en kopia där man släpper', async ({ page }) => {
  const api = await openWeek(page)
  const block = await eventBlock(page, 'Planering').boundingBox()
  if (!block) throw new Error('Händelsen syns inte')
  const grab = { x: block.x + block.width / 2, y: block.y + 13 }
  const dy = (await pointAt(page, '13:00', 0)).y - (await pointAt(page, '09:00', 0)).y

  await page.keyboard.down('Alt')
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y + dy / 2, { steps: 5 })
  await page.mouse.move(grab.x, grab.y + dy, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Alt')

  await expect(eventBlock(page, 'Planering')).toHaveCount(2)
  await expect.poll(() => posts(api).length).toBe(1)
  expect(posts(api)[0]?.body).toMatchObject({
    summary: 'Planering',
    description: 'Ta med kaffe',
    start: { dateTime: zonedTime(0, '13:00') },
    end: { dateTime: zonedTime(0, '14:00') },
  })
  // Originalet ligger kvar, och inget flyttades.
  expect(api.writeRequests.filter((w) => w.method === 'PATCH')).toHaveLength(0)
  expect(
    findByTitle(api, 'Planering')
      .map((event) => event.start)
      .toSorted(),
  ).toEqual([zonedTime(0, '09:00'), zonedTime(0, '13:00')].toSorted())
})

test('en händelse i en skrivskyddad kalender går varken att ta bort eller duplicera', async ({
  page,
}) => {
  const api = await openWeek(page)

  await eventBlock(page, 'Nationaldag').focus()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+d')

  await expect(eventBlock(page, 'Nationaldag')).toHaveCount(1)
  // Ge ett eventuellt anrop tid att gå iväg.
  await page.waitForTimeout(300)
  expect(api.writeRequests).toHaveLength(0)
})

test('kopian av en förekomst av en återkommande händelse blir en vanlig händelse', async ({
  page,
}) => {
  const api = await openWeek(page)

  await eventBlock(page, 'Veckomöte').focus()
  await page.keyboard.press('Control+d')

  await expect(eventBlock(page, 'Veckomöte')).toHaveCount(2)
  await expect.poll(() => posts(api).length).toBe(1)
  const body = posts(api)[0]?.body as Record<string, unknown>
  expect(Object.keys(body)).not.toContain('recurringEventId')
  expect(Object.keys(body)).not.toContain('recurrence')
  // Ingen fråga om serien: en kopia är alltid en egen händelse.
  await expect(page.getByTestId('recurrence-scope')).toHaveCount(0)
})
