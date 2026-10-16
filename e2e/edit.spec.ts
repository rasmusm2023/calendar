import { expect, test, type Page } from '@playwright/test'
import { eventBlock, openCalendar } from './support/app.ts'
import { clearAuthAccounts } from './support/auth.ts'
import {
  fakeGoogle,
  zonedTime,
  type CalendarApiMock,
  type FakeCalendar,
  type FakeEvent,
} from './support/google.ts'

const CALENDARS: FakeCalendar[] = [
  {
    id: 'work',
    name: 'Jobb',
    color: '#e11d48',
    selected: true,
    primary: true,
    defaultReminders: [{ method: 'popup', minutes: 30 }],
  },
  { id: 'readonly', name: 'Helgdagar', color: '#16a34a', selected: true, accessRole: 'reader' },
]

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
  await fakeGoogle.reset(request)
})

/** Öppnar veckan med klockan fast på 10:00. Händelserna ligger idag. */
async function openWeek(page: Page, setup?: (api: CalendarApiMock) => void) {
  await page.clock.setFixedTime(new Date(zonedTime(0, '10:00')))
  const work: FakeEvent[] = [
    {
      id: 'w1',
      title: 'Planering',
      start: zonedTime(0, '09:00'),
      end: zonedTime(0, '10:00'),
      location: 'Rum 4',
      description: 'Ta med kaffe',
    },
    {
      id: 'w2',
      title: 'Lunch',
      start: zonedTime(0, '12:00'),
      end: zonedTime(0, '13:00'),
    },
    {
      id: 'w3_20261021',
      title: 'Veckomöte',
      start: zonedTime(0, '15:00'),
      end: zonedTime(0, '16:00'),
      recurringEventId: 'w3',
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
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  return api
}

function panel(page: Page) {
  return page.getByRole('dialog', { name: 'Redigera händelse' })
}

function stored(api: CalendarApiMock, calendarId: string, eventId: string): FakeEvent {
  const event = api.events[calendarId].find((e) => e.id === eventId)
  if (!event) throw new Error(`Händelsen ${eventId} finns inte`)
  return event
}

test('ett klick öppnar panelen med händelsens uppgifter', async ({ page }) => {
  await openWeek(page)

  await eventBlock(page, 'Planering').click()

  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('textbox', { name: 'Titel' })).toHaveValue('Planering')
  await expect(panel(page).getByLabel('Starttid')).toHaveValue('09:00')
  await expect(panel(page).getByLabel('Sluttid')).toHaveValue('10:00')
  await expect(panel(page).getByRole('textbox', { name: 'Plats' })).toHaveValue('Rum 4')
  await expect(panel(page).getByRole('textbox', { name: 'Beskrivning' })).toHaveValue(
    'Ta med kaffe',
  )
  await expect(panel(page).getByText('Kalender: Jobb')).toBeVisible()
  // Händelsen använder kalenderns standardpåminnelse.
  await expect(panel(page).getByText('30 minuter före · Avisering')).toBeVisible()
})

test('händelsen går att öppna med tangentbordet', async ({ page }) => {
  await openWeek(page)

  await eventBlock(page, 'Planering').focus()
  await page.keyboard.press('Enter')

  await expect(panel(page)).toBeVisible()
})

test('ändrad titel, plats och beskrivning skickas som en PATCH med bara de fälten', async ({
  page,
}) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Kvartalsplanering')
  await panel(page).getByRole('textbox', { name: 'Plats' }).fill('Rum 7')
  await panel(page).getByRole('textbox', { name: 'Beskrivning' }).fill('Nya anteckningar')
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  // Panelen stängs och händelsen ser ny ut direkt.
  await expect(panel(page)).toBeHidden()
  await expect(eventBlock(page, 'Kvartalsplanering')).toBeVisible()
  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0]).toMatchObject({
    method: 'PATCH',
    path: '/calendars/work/events/w1',
    ifMatch: '"w1-1"',
    body: { summary: 'Kvartalsplanering', location: 'Rum 7', description: 'Nya anteckningar' },
  })
  expect(Object.keys(api.writeRequests[0]?.body as object)).not.toContain('start')
  expect(Object.keys(api.writeRequests[0]?.body as object)).not.toContain('reminders')
  expect(stored(api, 'work', 'w1')).toMatchObject({
    title: 'Kvartalsplanering',
    location: 'Rum 7',
    description: 'Nya anteckningar',
  })
})

test('Enter i titelfältet sparar', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Snabbt')
  await page.keyboard.press('Enter')

  await expect(eventBlock(page, 'Snabbt')).toBeVisible()
  await expect.poll(() => stored(api, 'work', 'w1').title).toBe('Snabbt')
})

test('en ny starttid flyttar händelsen och behåller längden', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByLabel('Starttid').fill('13:30')
  await expect(panel(page).getByLabel('Sluttid')).toHaveValue('14:30')
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect(eventBlock(page, 'Planering')).toContainText('13:30')
  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0]?.body).toMatchObject({
    start: { dateTime: zonedTime(0, '13:30') },
    end: { dateTime: zonedTime(0, '14:30') },
  })
  expect(Object.keys(api.writeRequests[0]?.body as object)).not.toContain('summary')
})

test('en tidsbestämd händelse blir heldag', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Lunch').click()

  await panel(page).getByRole('checkbox', { name: 'Heldag' }).check()
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect.poll(() => stored(api, 'work', 'w2').allDay).toBe(true)
  await expect(page.locator('.fc-daygrid-event', { hasText: 'Lunch' })).toBeVisible()
})

test('slutet före början stoppar sparandet', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByLabel('Sluttid').fill('08:00')

  await expect(panel(page).getByRole('alert')).toContainText('Kontrollera datum och tider')
  await expect(panel(page).getByRole('button', { name: 'Spara' })).toBeDisabled()
  expect(api.writeRequests).toHaveLength(0)
})

test('egna påminnelser sparas och visas när panelen öppnas igen', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByRole('checkbox', { name: 'Använd kalenderns standard' }).uncheck()
  // Börjar med kalenderns standard, så att inget försvinner av misstag.
  await expect(panel(page).getByLabel('Tid före start, påminnelse 1')).toHaveValue('30')
  await panel(page).getByLabel('Tid före start, påminnelse 1').selectOption('60')
  await panel(page).getByLabel('Metod, påminnelse 1').selectOption('email')
  await panel(page).getByRole('button', { name: 'Lägg till påminnelse' }).click()
  await panel(page).getByLabel('Tid före start, påminnelse 2').selectOption('1440')
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0]?.body).toMatchObject({
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 1440 },
      ],
    },
  })
  expect(Object.keys(api.writeRequests[0]?.body as object)).not.toContain('summary')

  await expect(page.getByRole('button', { name: 'Ångra' })).toBeVisible()
  await eventBlock(page, 'Planering').click()
  await expect(panel(page).getByLabel('Tid före start, påminnelse 1')).toHaveValue('60')
  await expect(panel(page).getByLabel('Metod, påminnelse 1')).toHaveValue('email')
  await expect(panel(page).getByLabel('Tid före start, påminnelse 2')).toHaveValue('1440')
})

test('ingen påminnelse alls skickas som en tom lista', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByRole('checkbox', { name: 'Använd kalenderns standard' }).uncheck()
  await panel(page).getByRole('button', { name: 'Ta bort påminnelse 1' }).click()
  await expect(panel(page).getByText('Inga påminnelser.')).toBeVisible()
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0]?.body).toMatchObject({
    reminders: { useDefault: false, overrides: [] },
  })
})

test('att tömma plats och beskrivning rensar dem hos Google', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByRole('textbox', { name: 'Plats' }).fill('')
  await panel(page).getByRole('textbox', { name: 'Beskrivning' }).fill('')
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0]?.body).toMatchObject({ location: null, description: null })
  expect(stored(api, 'work', 'w1').location).toBeUndefined()
  expect(stored(api, 'work', 'w1').description).toBeUndefined()
})

test('ångra från toasten återställer alla ändrade fält', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()
  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Ändrad')
  await panel(page).getByRole('textbox', { name: 'Beskrivning' }).fill('')
  await panel(page).getByLabel('Starttid').fill('11:00')
  await panel(page).getByRole('button', { name: 'Spara' }).click()
  await expect.poll(() => stored(api, 'work', 'w1').title).toBe('Ändrad')

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Planering')).toContainText('09:00')
  await expect.poll(() => stored(api, 'work', 'w1').title).toBe('Planering')
  expect(stored(api, 'work', 'w1')).toMatchObject({
    start: zonedTime(0, '09:00'),
    end: zonedTime(0, '10:00'),
    description: 'Ta med kaffe',
  })
  // Ångra använder etag från den första ändringen (inget 412).
  expect(api.writeRequests[1]?.ifMatch).toBe('"w1-2"')
})

test('misslyckat sparande återställer händelsen och erbjuder att försöka igen', async ({
  page,
}) => {
  const api = await openWeek(page, (mock) => {
    mock.failWrites = { status: 500, reason: 'backendError' }
  })
  await eventBlock(page, 'Planering').click()
  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Ny titel')
  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect(page.getByText('Kunde inte spara: Redigera Planering')).toBeVisible()
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  expect(stored(api, 'work', 'w1').title).toBe('Planering')

  api.failWrites = null
  await page.getByRole('button', { name: 'Försök igen' }).click()
  await expect(eventBlock(page, 'Ny titel')).toBeVisible()
  await expect.poll(() => stored(api, 'work', 'w1').title).toBe('Ny titel')
})

test('Esc och Avbryt stänger panelen utan att spara', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()
  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Bort med mig')

  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await eventBlock(page, 'Planering').click()
  await expect(panel(page).getByRole('textbox', { name: 'Titel' })).toHaveValue('Planering')
  await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Bort med mig')
  await panel(page).getByRole('button', { name: 'Avbryt' }).click()

  await expect(panel(page)).toBeHidden()
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  expect(api.writeRequests).toHaveLength(0)
})

test('Spara utan ändringar stänger panelen och skickar inget', async ({ page }) => {
  const api = await openWeek(page)
  await eventBlock(page, 'Planering').click()

  await panel(page).getByRole('button', { name: 'Spara' }).click()

  await expect(panel(page)).toBeHidden()
  expect(api.writeRequests).toHaveLength(0)
})

test('en händelse i en skrivskyddad kalender öppnas låst', async ({ page }) => {
  const api = await openWeek(page)

  await eventBlock(page, 'Nationaldag').click()

  const dialog = page.getByRole('dialog', { name: 'Händelse' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status')).toContainText('läsrätt')
  await expect(dialog.getByRole('textbox', { name: 'Titel' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Spara' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Stäng' }).click()
  await expect(dialog).toBeHidden()
  expect(api.writeRequests).toHaveLength(0)
})

test('en instans av en återkommande händelse öppnas låst', async ({ page }) => {
  await openWeek(page)

  await eventBlock(page, 'Veckomöte').click()

  const dialog = page.getByRole('dialog', { name: 'Händelse' })
  await expect(dialog.getByRole('status')).toContainText('Återkommande')
  await expect(dialog.getByRole('textbox', { name: 'Titel' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Spara' })).toHaveCount(0)
})
