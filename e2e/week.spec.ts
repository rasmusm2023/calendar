import { expect, test, type Page } from '@playwright/test'
import { openCalendar, eventBlock } from './support/app.ts'
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
  { id: 'private', name: 'Privat', color: '#2563eb', selected: true },
  { id: 'holidays', name: 'Helgdagar', color: '#16a34a', selected: false },
]

const EVENTS: Record<string, FakeEvent[]> = {
  work: [
    { id: 'w1', title: 'Planering', start: zonedTime(0, '09:00'), end: zonedTime(0, '10:00') },
    { id: 'w2', title: 'Veckomöte', start: zonedTime(7, '09:00'), end: zonedTime(7, '10:00') },
  ],
  private: [
    { id: 'p1', title: 'Tandläkare', start: zonedTime(0, '13:00'), end: zonedTime(0, '14:00') },
  ],
  holidays: [
    {
      id: 'h1',
      title: 'Nationaldag',
      start: zonedTime(0, '00:00').slice(0, 10),
      end: zonedTime(1, '00:00').slice(0, 10),
      allDay: true,
    },
  ],
}

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
  await fakeGoogle.reset(request)
})

/** Loggar in, kopplar Google Calendar och väntar på veckovyn. */
function openWeek(page: Page, setup?: (api: CalendarApiMock) => void) {
  return openCalendar(page, { calendars: CALENDARS, events: EVENTS }, setup)
}

const event = eventBlock

test('koppla Google Calendar och se veckan med kalenderfärger och kalendervalg', async ({
  page,
}) => {
  await openWeek(page)

  // Kalendrar som är tända i Google visas, med kalenderns färg. Släckta kalendrar visas inte.
  await expect(event(page, 'Planering')).toBeVisible()
  await expect(event(page, 'Tandläkare')).toBeVisible()
  await expect(event(page, 'Nationaldag')).toHaveCount(0)
  await expect(event(page, 'Planering')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await expect(event(page, 'Tandläkare')).toHaveCSS('background-color', 'rgb(37, 99, 235)')

  // Flera kalendrar samtidigt, och ett val som går att ändra.
  await expect(page.getByRole('checkbox', { name: 'Jobb' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Privat' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Helgdagar' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Helgdagar' }).check()
  await expect(event(page, 'Nationaldag')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Privat' }).uncheck()
  await expect(event(page, 'Tandläkare')).toHaveCount(0)
  await expect(event(page, 'Planering')).toBeVisible()

  // Bläddra: nästa vecka har andra händelser, och "Idag" tar tillbaka.
  await page.getByRole('button', { name: 'Nästa vecka' }).click()
  await expect(event(page, 'Veckomöte')).toBeVisible()
  await expect(event(page, 'Planering')).toHaveCount(0)
  await page.getByRole('button', { name: 'Idag' }).click()
  await expect(event(page, 'Planering')).toBeVisible()

  // Efter omladdning är man kvar inloggad och kopplad, utan att behöva koppla om, och valet finns kvar.
  await page.reload()
  await expect(page.getByTestId('app-root')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Koppla Google Calendar' })).toHaveCount(0)
  await expect(event(page, 'Planering')).toBeVisible()
  await expect(event(page, 'Nationaldag')).toBeVisible()
  await expect(event(page, 'Tandläkare')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Privat' })).not.toBeChecked()
})

test('återkallad åtkomst ger "Koppla om" och veckan visas igen efter ny koppling', async ({
  page,
  request,
}) => {
  const api = await openWeek(page)
  await expect(event(page, 'Planering')).toBeVisible()

  // Användaren återkallar åtkomsten hos Google: token-servern vägrar förnya och Calendar API ger 401.
  await fakeGoogle.revoke(request)
  api.unauthorized = true
  await page.getByRole('button', { name: 'Nästa vecka' }).click()

  await expect(page.getByRole('button', { name: 'Koppla om' })).toBeVisible()
  await expect(page.getByTestId('app-root')).toHaveCount(0)

  // Ny koppling.
  await fakeGoogle.restore(request)
  api.unauthorized = false
  await page.getByRole('button', { name: 'Koppla om' }).click()

  await expect(page.getByTestId('app-root')).toBeVisible()
  await expect(event(page, 'Planering')).toBeVisible()
})

test('en kalender som inte går att hämta stoppar inte de andra och går att försöka igen', async ({
  page,
}) => {
  const api = await openWeek(page, (mock) => {
    mock.forbidden.add('work')
  })

  await expect(event(page, 'Tandläkare')).toBeVisible()
  await expect(event(page, 'Planering')).toHaveCount(0)
  const warning = page.getByTestId('calendar-events-error')
  await expect(warning).toContainText('1 av 2 kalendrar visas inte')

  api.forbidden.clear()
  await warning.getByRole('button', { name: 'Försök igen' }).click()

  await expect(event(page, 'Planering')).toBeVisible()
  await expect(warning).toHaveCount(0)
  await expect(event(page, 'Tandläkare')).toBeVisible()
})

test('hämtar bara veckan som visas', async ({ page }) => {
  const api = await openWeek(page)
  await expect(event(page, 'Planering')).toBeVisible()

  const first = api.eventRequests.at(0)
  expect(first).toBeDefined()
  const span = Date.parse(first?.timeMax ?? '') - Date.parse(first?.timeMin ?? '')
  // En vecka, plus/minus en timme för sommartidsbyte.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  expect(Math.abs(span - WEEK_MS)).toBeLessThanOrEqual(60 * 60 * 1000)
})

test('byt mellan dag, N dagar, månad och schema, och vyn finns kvar efter omladdning', async ({
  page,
}) => {
  const api = await openWeek(page)
  await expect(event(page, 'Planering')).toBeVisible()
  const views = page.getByRole('group', { name: 'Vy' })
  const columns = page.locator('.fc-col-header-cell')
  await expect(columns).toHaveCount(7)

  // Dag: bara idag.
  await views.getByRole('button', { name: 'Dag', exact: true }).click()
  await expect(columns).toHaveCount(1)
  await expect(event(page, 'Planering')).toBeVisible()
  await expect(event(page, 'Veckomöte')).toHaveCount(0)

  // N dagar: antalet går att ändra.
  await views.getByRole('button', { name: '3 dagar', exact: true }).click()
  await expect(columns).toHaveCount(3)
  await page.getByRole('combobox', { name: 'Antal dagar' }).selectOption('5')
  await expect(columns).toHaveCount(5)

  // Schema: lista över 30 dygn, här syns även nästa veckas möte.
  await views.getByRole('button', { name: 'Schema', exact: true }).click()
  await expect(page.locator('.fc-list')).toBeVisible()
  await expect(event(page, 'Planering')).toBeVisible()
  await expect(event(page, 'Veckomöte')).toBeVisible()

  // Månad: tidsbestämda händelser är fyllda block i kalenderns färg, och det hämtas hela veckor.
  await views.getByRole('button', { name: 'Månad', exact: true }).click()
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible()
  await expect(event(page, 'Planering')).toBeVisible()
  await expect(page.locator('.fc-daygrid-block-event', { hasText: 'Planering' })).toHaveCSS(
    'background-color',
    'rgb(225, 29, 72)',
  )
  const monthRequest = api.eventRequests.at(-1)
  const monthSpanDays =
    (Date.parse(monthRequest?.timeMax ?? '') - Date.parse(monthRequest?.timeMin ?? '')) /
    (24 * 60 * 60 * 1000)
  expect(monthSpanDays).toBeGreaterThanOrEqual(28)
  expect(monthSpanDays).toBeLessThanOrEqual(42)

  // Bläddra en månad framåt och tillbaka med Idag.
  await page.getByRole('button', { name: 'Nästa månad' }).click()
  await expect(event(page, 'Planering')).toHaveCount(0)
  await page.getByRole('button', { name: 'Idag' }).click()
  await expect(event(page, 'Planering')).toBeVisible()

  // Vyn minns man efter omladdning.
  await page.reload()
  await expect(page.getByTestId('app-root')).toBeVisible()
  await expect(views.getByRole('button', { name: 'Månad', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(event(page, 'Planering')).toBeVisible()
})

test('veckovyn scrollar till aktuell tid och visar nu-linjen', async ({ page }) => {
  // Lågt fönster och sen kvällstid: utan scroll hamnar nu-linjen långt under det som syns (rutnätet
  // börjar på förmiddagen), så den syns bara om kalendern faktiskt scrollat till aktuell tid.
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.clock.setFixedTime(new Date(zonedTime(0, '22:30')))
  await openWeek(page)

  const nowLine = page.locator('.fc-timegrid-now-indicator-line')
  await expect(nowLine).toBeAttached()
  await expect(nowLine).toBeInViewport()
})

test('förhämtar grannveckorna så att bläddring inte hämtar något nytt', async ({ page }) => {
  const api = await openWeek(page)
  await expect(event(page, 'Planering')).toBeVisible()

  // Två kalendrar och tre veckor: den öppna, nästa och föregående.
  await expect.poll(() => api.eventRequests.length).toBe(6)
  expect(new Set(api.eventRequests.map((request) => request.timeMin)).size).toBe(3)

  await page.getByRole('button', { name: 'Nästa vecka' }).click()
  await expect(event(page, 'Veckomöte')).toBeVisible()
  await expect(event(page, 'Planering')).toHaveCount(0)

  // Veckan hämtades inte om när den öppnades (datan var färsk), bara dess nya granne hämtas.
  await expect.poll(() => api.eventRequests.length).toBe(8)
  const perWeek = new Map<string, number>()
  for (const { timeMin } of api.eventRequests) perWeek.set(timeMin, (perWeek.get(timeMin) ?? 0) + 1)
  expect(perWeek.size).toBe(4)
  expect([...perWeek.values()]).toEqual([2, 2, 2, 2])
})

test('uppdaterar öppen vecka när något ändrats hos Google, utan att användaren gör något', async ({
  page,
}) => {
  await page.clock.install()
  const api = await openWeek(page)
  await expect(event(page, 'Planering')).toBeVisible()

  // Ändringen görs utanför appen (t.ex. i Googles egen kalender).
  const planning = api.events.work.find((e) => e.id === 'w1')
  expect(planning).toBeDefined()
  if (planning) planning.title = 'Planering flyttad'
  await expect(event(page, 'Planering flyttad')).toHaveCount(0)

  await page.clock.fastForward(61_000)

  await expect(event(page, 'Planering flyttad')).toBeVisible()
})
