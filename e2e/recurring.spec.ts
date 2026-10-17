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

/**
 * Öppnar veckan med klockan fast på 10:00. "Veckomöte" är en serie som varje vecka samma veckodag klockan
 * 15:00–16:00. Den började för två veckor sedan, så den har en förekomst idag, en förra veckan och en nästa vecka.
 */
async function openSeries(page: Page, setup?: (api: CalendarApiMock) => void) {
  await page.clock.setFixedTime(new Date(zonedTime(0, '10:00')))
  const work: FakeEvent[] = [
    {
      id: 's1',
      title: 'Veckomöte',
      location: 'Rum 4',
      start: zonedTime(-14, '15:00'),
      end: zonedTime(-14, '16:00'),
      recurrence: ['RRULE:FREQ=WEEKLY'],
      timeZone: 'Europe/Stockholm',
    },
  ]
  const api = await openCalendar(
    page,
    {
      calendars: CALENDARS,
      events: {
        work,
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
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  return api
}

const panel = (page: Page) => page.getByRole('dialog', { name: 'Redigera händelse' })
const scopeDialog = (page: Page, name: string) => page.getByRole('dialog', { name })
const writes = (api: CalendarApiMock, method: string) =>
  api.writeRequests.filter((w) => w.method === method)
const master = (api: CalendarApiMock, id = 's1') => {
  const found = api.events.work.find((event) => event.id === id)
  if (!found) throw new Error(`Serien ${id} finns inte`)
  return found
}

async function nextWeek(page: Page) {
  await page.getByRole('button', { name: 'Nästa vecka' }).click()
}

async function previousWeek(page: Page) {
  await page.getByRole('button', { name: 'Föregående vecka' }).click()
}

/** Ändrar titeln på dagens förekomst i panelen och väljer vad ändringen gäller. */
async function renameToday(page: Page, title: string, scope: string) {
  await eventBlock(page, 'Veckomöte').click()
  const title_ = panel(page).getByRole('textbox', { name: 'Titel' })
  await title_.fill(title)
  await panel(page).getByRole('button', { name: 'Spara' }).click()
  const dialog = scopeDialog(page, 'Ändra återkommande händelse')
  await dialog.getByRole('radio', { name: scope }).click()
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(panel(page)).toBeHidden()
}

test('panelen är redigerbar för en förekomst, och Spara frågar vad ändringen gäller', async ({
  page,
}) => {
  const api = await openSeries(page)

  await eventBlock(page, 'Veckomöte').click()
  await expect(panel(page).getByRole('textbox', { name: 'Titel' })).toBeEnabled()
  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Ändrat')
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  const dialog = scopeDialog(page, 'Ändra återkommande händelse')
  await expect(dialog.getByRole('radio', { name: 'Bara den här händelsen' })).toBeChecked()
  // Frågan ligger över panelen: ångrar man sig finns allt kvar, och inget har skickats.
  await dialog.getByRole('button', { name: 'Avbryt' }).click()
  await expect(dialog).toBeHidden()
  await expect(panel(page).getByRole('textbox', { name: 'Titel' })).toHaveValue('Ändrat')
  expect(api.writeRequests).toHaveLength(0)
})

test('bara den här händelsen ändrar bara den förekomsten', async ({ page }) => {
  const api = await openSeries(page)

  await renameToday(page, 'Särskilt möte', 'Bara den här händelsen')

  await expect(eventBlock(page, 'Särskilt möte')).toBeVisible()
  await expect.poll(() => writes(api, 'PATCH').length).toBe(1)
  const patch = writes(api, 'PATCH')[0]
  expect(patch.path).toMatch(/\/events\/s1_\d{8}$/)
  expect(patch.body).toEqual({ summary: 'Särskilt möte' })
  expect(master(api).title).toBe('Veckomöte')

  await nextWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  await previousWeek(page)
  await expect(eventBlock(page, 'Särskilt möte')).toBeVisible()
})

test('alla händelser ändrar hela serien', async ({ page }) => {
  const api = await openSeries(page)

  await renameToday(page, 'Nytt namn', 'Alla händelser')

  await expect(eventBlock(page, 'Nytt namn')).toBeVisible()
  await expect.poll(() => writes(api, 'PATCH').length).toBe(1)
  expect(writes(api, 'PATCH')[0]?.path).toMatch(/\/events\/s1$/)
  expect(writes(api, 'PATCH')[0]?.ifMatch).toBeUndefined()
  expect(master(api).title).toBe('Nytt namn')

  await nextWeek(page)
  await expect(eventBlock(page, 'Nytt namn')).toBeVisible()
  await previousWeek(page)
  await previousWeek(page)
  await expect(eventBlock(page, 'Nytt namn')).toBeVisible()
})

test('den här och följande delar serien i två', async ({ page }) => {
  const api = await openSeries(page)

  await renameToday(page, 'Nytt namn', 'Den här och följande händelser')

  await expect(eventBlock(page, 'Nytt namn')).toBeVisible()
  await expect.poll(() => writes(api, 'PATCH').length).toBe(1)
  // Den nya serien skapas först, med reglerna och förekomstens tid, och den gamla kortas av.
  expect(writes(api, 'POST')).toHaveLength(1)
  const created = writes(api, 'POST')[0]?.body as Record<string, unknown>
  expect(created).toMatchObject({
    summary: 'Nytt namn',
    location: 'Rum 4',
    recurrence: ['RRULE:FREQ=WEEKLY'],
    start: { dateTime: zonedTime(0, '15:00'), timeZone: 'Europe/Stockholm' },
  })
  const patched = writes(api, 'PATCH')[0]?.body as { recurrence: string[] }
  expect(patched.recurrence).toHaveLength(1)
  expect(patched.recurrence[0]).toMatch(/^RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z$/)
  expect(master(api).recurrence).toEqual(patched.recurrence)

  // Nästa vecka tillhör den nya serien, förra veckan den gamla.
  await nextWeek(page)
  await expect(eventBlock(page, 'Nytt namn')).toBeVisible()
  await previousWeek(page)
  await previousWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  await expect(eventBlock(page, 'Nytt namn')).toHaveCount(0)
})

test('Ångra efter att serien delats sätter tillbaka den gamla serien', async ({ page }) => {
  const api = await openSeries(page)
  await renameToday(page, 'Nytt namn', 'Den här och följande händelser')
  await expect.poll(() => writes(api, 'PATCH').length).toBe(1)

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  await expect(eventBlock(page, 'Nytt namn')).toHaveCount(0)
  expect(master(api).recurrence).toEqual(['RRULE:FREQ=WEEKLY'])
  expect(api.events.work.map((event) => event.id)).toEqual(['s1'])
})

test('Ångra efter att hela serien ändrats sätter tillbaka titeln', async ({ page }) => {
  const api = await openSeries(page)
  await renameToday(page, 'Nytt namn', 'Alla händelser')
  await expect.poll(() => master(api).title).toBe('Nytt namn')

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect.poll(() => master(api).title).toBe('Veckomöte')
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
})

test('en misslyckad ändring av serien rullas tillbaka med en toast', async ({ page }) => {
  const api = await openSeries(page, (mock) => {
    mock.failWrites = { status: 500, reason: 'backendError' }
  })

  await renameToday(page, 'Nytt namn', 'Alla händelser')

  await expect(page.getByText('Kunde inte spara: Redigera Veckomöte')).toBeVisible()
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  await expect(eventBlock(page, 'Nytt namn')).toHaveCount(0)
  expect(master(api).title).toBe('Veckomöte')
})

test('att dra en förekomst frågar vad flytten gäller, och Avbryt lämnar den kvar', async ({
  page,
}) => {
  const api = await openSeries(page)
  const block = await eventBlock(page, 'Veckomöte').boundingBox()
  if (!block) throw new Error('Händelsen syns inte')
  const grab = { x: block.x + block.width / 2, y: block.y + 13 }
  const dy = (await pointAt(page, '16:00', 0)).y - (await pointAt(page, '15:00', 0)).y

  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y + dy / 2, { steps: 5 })
  await page.mouse.move(grab.x, grab.y + dy, { steps: 10 })
  await page.mouse.up()

  const dialog = scopeDialog(page, 'Ändra återkommande händelse')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Avbryt' }).click()

  await expect(dialog).toBeHidden()
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  const after = await eventBlock(page, 'Veckomöte').boundingBox()
  expect(Math.abs((after?.y ?? 0) - block.y)).toBeLessThan(2)
  expect(api.writeRequests).toHaveLength(0)
})

test('att dra en förekomst och välja alla flyttar hela serien', async ({ page }) => {
  const api = await openSeries(page)
  const block = await eventBlock(page, 'Veckomöte').boundingBox()
  if (!block) throw new Error('Händelsen syns inte')
  const grab = { x: block.x + block.width / 2, y: block.y + 13 }
  const dy = (await pointAt(page, '16:00', 0)).y - (await pointAt(page, '15:00', 0)).y

  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y + dy / 2, { steps: 5 })
  await page.mouse.move(grab.x, grab.y + dy, { steps: 10 })
  await page.mouse.up()
  const dialog = scopeDialog(page, 'Ändra återkommande händelse')
  await dialog.getByRole('radio', { name: 'Alla händelser' }).click()
  await dialog.getByRole('button', { name: 'OK' }).click()

  await expect.poll(() => writes(api, 'PATCH').length).toBe(1)
  expect(writes(api, 'PATCH')[0]?.path).toMatch(/\/events\/s1$/)
  expect(master(api).start).toBe(zonedTime(-14, '16:00'))
  expect(master(api).end).toBe(zonedTime(-14, '17:00'))
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  await nextWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toContainText('16:00')
})

test('Delete på en förekomst frågar vad som ska tas bort', async ({ page }) => {
  const api = await openSeries(page)

  await eventBlock(page, 'Veckomöte').focus()
  await page.keyboard.press('Delete')

  const dialog = scopeDialog(page, 'Ta bort återkommande händelse')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Avbryt' }).click()
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  expect(api.writeRequests).toHaveLength(0)

  await eventBlock(page, 'Veckomöte').focus()
  await page.keyboard.press('Delete')
  await scopeDialog(page, 'Ta bort återkommande händelse')
    .getByRole('button', { name: 'OK' })
    .click()

  // Förvalet är "Bara den här händelsen": en förekomst tas bort, serien finns kvar.
  await expect(eventBlock(page, 'Veckomöte')).toHaveCount(0)
  await expect.poll(() => writes(api, 'DELETE').length).toBe(1)
  expect(writes(api, 'DELETE')[0]?.path).toMatch(/\/events\/s1_\d{8}$/)
  await nextWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
})

test('Ta bort alla händelser tar bort serien, och Ångra skapar den igen', async ({ page }) => {
  const api = await openSeries(page)
  await eventBlock(page, 'Veckomöte').click()
  await panel(page).getByRole('button', { name: 'Ta bort', exact: true }).click()
  const dialog = scopeDialog(page, 'Ta bort återkommande händelse')
  await dialog.getByRole('radio', { name: 'Alla händelser' }).click()
  await dialog.getByRole('button', { name: 'OK' }).click()

  await expect(eventBlock(page, 'Veckomöte')).toHaveCount(0)
  await expect.poll(() => writes(api, 'DELETE').length).toBe(1)
  expect(writes(api, 'DELETE')[0]?.path).toMatch(/\/events\/s1$/)
  await nextWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toHaveCount(0)
  await previousWeek(page)

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
  // Händelsen syns direkt (optimistiskt). POST skickas först när den pågående borttagningen är klar.
  await expect.poll(() => writes(api, 'POST').length).toBe(1)
  expect(writes(api, 'POST')[0]?.body).toMatchObject({
    summary: 'Veckomöte',
    recurrence: ['RRULE:FREQ=WEEKLY'],
  })
  await nextWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
})

test('Ta bort den här och följande kortar av serien', async ({ page }) => {
  const api = await openSeries(page)
  await eventBlock(page, 'Veckomöte').focus()
  await page.keyboard.press('Delete')
  const dialog = scopeDialog(page, 'Ta bort återkommande händelse')
  await dialog.getByRole('radio', { name: 'Den här och följande händelser' }).click()
  await dialog.getByRole('button', { name: 'OK' }).click()

  await expect(eventBlock(page, 'Veckomöte')).toHaveCount(0)
  await expect.poll(() => writes(api, 'PATCH').length).toBe(1)
  expect(writes(api, 'DELETE')).toHaveLength(0)
  expect(master(api).recurrence?.[0]).toMatch(/^RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z$/)

  await nextWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toHaveCount(0)
  await previousWeek(page)
  await previousWeek(page)
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()

  await nextWeek(page)
  await page.getByRole('button', { name: 'Ångra' }).click()
  await expect.poll(() => master(api).recurrence).toEqual(['RRULE:FREQ=WEEKLY'])
  await expect(eventBlock(page, 'Veckomöte')).toBeVisible()
})
