import { expect, test, type Locator, type Page } from '@playwright/test'
import { eventBlock, openCalendar, pointAt } from './support/app.ts'
import { clearAuthAccounts } from './support/auth.ts'
import { fakeGoogle, zonedTime, type CalendarApiMock, type FakeCalendar } from './support/google.ts'

const CALENDARS: FakeCalendar[] = [
  { id: 'work', name: 'Jobb', color: '#e11d48', selected: true, primary: true },
  { id: 'readonly', name: 'Helgdagar', color: '#16a34a', selected: true, accessRole: 'reader' },
]

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
  await fakeGoogle.reset(request)
})

/** Öppnar veckan med klockan fast på 10:00. "Planering" ligger idag 09:00-10:00. */
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
          },
        ],
        readonly: [
          {
            id: 'r1',
            title: 'Nationaldag',
            start: zonedTime(0, '13:00'),
            end: zonedTime(0, '14:00'),
          },
        ],
      },
    },
    setup,
  )
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  return api
}

/** Mitt i den andra kvartsraden (en kvart är ca 9 px), så att några pixlars avvikelse inte ger fel kvart. */
const GRAB_OFFSET_PX = 13

/** En punkt strax under överkanten på en händelse, så att den inte hamnar på någon av kanternas handtag. */
async function grabPoint(block: Locator) {
  const box = await block.boundingBox()
  if (!box) throw new Error('Händelsen syns inte')
  return { x: box.x + box.width / 2, y: box.y + GRAB_OFFSET_PX }
}

/** Drar med musen i flera steg, som en användare, så att FullCalendar hinner följa med. */
async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { release?: boolean } = {},
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
  if (options.release !== false) await page.mouse.up()
}

/** Hur många pixlar rutnätet är högt mellan två klockslag. */
async function pixelsBetween(page: Page, from: string, to: string) {
  return (await pointAt(page, to, 0)).y - (await pointAt(page, from, 0)).y
}

async function dragEventTo(page: Page, title: string, time: string, from = '09:00') {
  const grab = await grabPoint(eventBlock(page, title))
  const dy = await pixelsBetween(page, from, time)
  await dragMouse(page, grab, { x: grab.x, y: grab.y + dy })
}

function startOf(api: CalendarApiMock, id: string) {
  return api.events.work.find((event) => event.id === id)?.start
}

function endOf(api: CalendarApiMock, id: string) {
  return api.events.work.find((event) => event.id === id)?.end
}

test('dra en händelse till en annan tid: syns direkt och sparas med If-Match', async ({ page }) => {
  const api = await openWeek(page)

  await dragEventTo(page, 'Planering', '13:00')

  await expect(eventBlock(page, 'Planering')).toContainText('13:00')
  await expect.poll(() => api.writeRequests.length).toBe(1)
  const [write] = api.writeRequests
  expect(write).toMatchObject({
    method: 'PATCH',
    path: '/calendars/work/events/w1',
    ifMatch: '"w1-1"',
    body: {
      start: { dateTime: zonedTime(0, '13:00') },
      end: { dateTime: zonedTime(0, '14:00') },
    },
  })
  expect(startOf(api, 'w1')).toBe(zonedTime(0, '13:00'))
  // Toasten bekräftar och erbjuder ångra.
  await expect(page.getByRole('button', { name: 'Ångra' })).toBeVisible()
})

test('dra en händelse till en annan dag behåller tiden', async ({ page }) => {
  const api = await openWeek(page)
  const column = await page.locator('.fc-timegrid-col.fc-day-today').boundingBox()
  if (!column) throw new Error('Hittade inte dagens kolumn')
  const grab = await grabPoint(eventBlock(page, 'Planering'))
  // Dagen före eller efter, beroende på vilken veckodag det är idag, så att vi alltid hamnar i veckan.
  const next = await page.locator('.fc-timegrid-col.fc-day-today + .fc-timegrid-col').count()
  const dx = next > 0 ? column.width : -column.width

  await dragMouse(page, grab, { x: grab.x + dx, y: grab.y })

  await expect.poll(() => api.writeRequests.length).toBe(1)
  const moved = startOf(api, 'w1')
  expect(moved).not.toBe(zonedTime(0, '09:00'))
  expect(moved).toMatch(/T09:00:00[+-]\d\d:00$/)
})

test('snäpper till 15 minuter', async ({ page }) => {
  const api = await openWeek(page)

  const grab = await grabPoint(eventBlock(page, 'Planering'))
  const quarter = (await pixelsBetween(page, '09:00', '10:00')) / 4
  // Ungefär 1,6 kvartar nedåt: någonstans mellan, men alltid på en jämn kvart och med bibehållen längd.
  await dragMouse(page, grab, { x: grab.x, y: grab.y + quarter * 1.6 })

  await expect.poll(() => api.writeRequests.length).toBe(1)
  const start = startOf(api, 'w1') ?? ''
  expect(start).toMatch(/T09:(15|30):00[+-]\d\d:00$/)
  const minutes = start.slice(14, 16)
  expect(endOf(api, 'w1')).toBe(zonedTime(0, `10:${minutes}`))
})

test('dra i nederkanten ändrar längden', async ({ page }) => {
  const api = await openWeek(page)
  const block = eventBlock(page, 'Planering')
  // FullCalendar visar handtagen först när musen är över händelsen.
  await block.hover()
  const handle = await block.locator('.fc-event-resizer-end').boundingBox()
  if (!handle) throw new Error('Hittade inte handtaget i nederkanten')
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const dy = await pixelsBetween(page, '10:00', '12:00')

  await dragMouse(page, from, { x: from.x, y: from.y + dy })

  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(startOf(api, 'w1')).toBe(zonedTime(0, '09:00'))
  expect(endOf(api, 'w1')).toBe(zonedTime(0, '12:00'))
  await expect(page.getByText('Ändra längd på Planering', { exact: true })).toBeVisible()
})

test('dra i överkanten ändrar starttiden', async ({ page }) => {
  const api = await openWeek(page)
  const block = eventBlock(page, 'Planering')
  await block.hover()
  const handle = await block.locator('.fc-event-resizer-start').boundingBox()
  if (!handle) throw new Error('Hittade inte handtaget i överkanten')
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const dy = await pixelsBetween(page, '09:00', '09:30')

  await dragMouse(page, from, { x: from.x, y: from.y + dy })

  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(startOf(api, 'w1')).toBe(zonedTime(0, '09:30'))
  expect(endOf(api, 'w1')).toBe(zonedTime(0, '10:00'))
})

test('Esc avbryter en pågående dragning utan att något sparas', async ({ page }) => {
  const api = await openWeek(page)
  const grab = await grabPoint(eventBlock(page, 'Planering'))
  const dy = await pixelsBetween(page, '09:00', '13:00')

  await dragMouse(page, grab, { x: grab.x, y: grab.y + dy }, { release: false })
  // Mitt i dragningen: spöket visar den nya tiden.
  await expect(page.locator('.fc-event-mirror')).toContainText('13:00')
  await page.keyboard.press('Escape')
  await page.mouse.up()

  await expect(eventBlock(page, 'Planering')).toHaveCount(1)
  await expect(eventBlock(page, 'Planering')).toContainText('09:00')
  await expect(page.locator('.fc-event-mirror')).toHaveCount(0)
  // Ge ett eventuellt anrop tid att dyka upp.
  await page.waitForTimeout(300)
  expect(api.writeRequests).toEqual([])

  // Nästa dragning fungerar som vanligt.
  await dragEventTo(page, 'Planering', '11:00')
  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(startOf(api, 'w1')).toBe(zonedTime(0, '11:00'))
})

test('dra till heldagsraden gör händelsen till en heldagshändelse', async ({ page }) => {
  const api = await openWeek(page)
  const grab = await grabPoint(eventBlock(page, 'Planering'))
  const allDayRow = await page
    .locator('.fc-daygrid-body .fc-daygrid-day.fc-day-today')
    .boundingBox()
  if (!allDayRow) throw new Error('Hittade inte heldagsraden')

  await dragMouse(page, grab, { x: grab.x, y: allDayRow.y + allDayRow.height / 2 })

  await expect.poll(() => api.writeRequests.length).toBe(1)
  const today = zonedTime(0, '12:00').slice(0, 10)
  expect(api.writeRequests[0].body).toMatchObject({
    start: { date: today, dateTime: null },
    end: { dateTime: null },
  })
  const event = api.events.work.find((e) => e.id === 'w1')
  expect(event).toMatchObject({ allDay: true, start: today })
  await expect(page.locator('.fc-daygrid-event', { hasText: 'Planering' })).toBeVisible()
})

test('dra en heldagshändelse till tidsrutnätet ger en timme', async ({ page }) => {
  const today = zonedTime(0, '12:00').slice(0, 10)
  const tomorrow = new Date(`${today}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const api = await openWeek(page, (mock) => {
    mock.events.work.push({
      id: 'w2',
      title: 'Konferens',
      start: today,
      end: tomorrow.toISOString().slice(0, 10),
      allDay: true,
    })
  })
  const block = page.locator('.fc-daygrid-event', { hasText: 'Konferens' })
  await expect(block).toBeVisible()
  const box = await block.boundingBox()
  if (!box) throw new Error('Heldagshändelsen syns inte')
  const target = await pointAt(page, '14:00')

  await dragMouse(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, target)

  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0].body).toMatchObject({
    start: { dateTime: zonedTime(0, '14:00'), date: null },
    end: { dateTime: zonedTime(0, '15:00'), date: null },
  })
  expect(startOf(api, 'w2')).toBe(zonedTime(0, '14:00'))
  await expect(page.locator('.fc-timegrid-event', { hasText: 'Konferens' })).toBeVisible()
})

test('misslyckat sparande flyttar tillbaka händelsen och erbjuder att försöka igen', async ({
  page,
}) => {
  const api = await openWeek(page, (mock) => {
    mock.failWrites = { status: 500, reason: 'backendError' }
  })

  await dragEventTo(page, 'Planering', '13:00')

  await expect(page.getByText('Kunde inte spara: Flytta Planering')).toBeVisible()
  await expect(eventBlock(page, 'Planering')).toContainText('09:00')
  expect(startOf(api, 'w1')).toBe(zonedTime(0, '09:00'))

  api.failWrites = null
  await page.getByRole('button', { name: 'Försök igen' }).click()
  await expect(eventBlock(page, 'Planering')).toContainText('13:00')
  await expect.poll(() => startOf(api, 'w1')).toBe(zonedTime(0, '13:00'))
})

test('ångra från toasten flyttar tillbaka händelsen', async ({ page }) => {
  const api = await openWeek(page)
  await dragEventTo(page, 'Planering', '13:00')
  await expect.poll(() => startOf(api, 'w1')).toBe(zonedTime(0, '13:00'))

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Planering')).toContainText('09:00')
  await expect.poll(() => startOf(api, 'w1')).toBe(zonedTime(0, '09:00'))
  // Ångra använder etag från den första ändringen (inget 412).
  expect(api.writeRequests[1].ifMatch).toBe('"w1-2"')
})

test('två snabba flyttar av samma händelse: den sista vinner och ingen får 412', async ({
  page,
}) => {
  const api = await openWeek(page, (mock) => {
    mock.writeDelayMs = 500
  })

  await dragEventTo(page, 'Planering', '11:00')
  // Första anropet är fortfarande på väg. Flytta igen direkt.
  await expect(eventBlock(page, 'Planering')).toContainText('11:00')
  await dragEventTo(page, 'Planering', '14:00', '11:00')
  await expect(eventBlock(page, 'Planering')).toContainText('14:00')

  await expect.poll(() => startOf(api, 'w1')).toBe(zonedTime(0, '14:00'))
  await expect(page.getByText(/Kunde inte spara/)).toHaveCount(0)
  expect(api.writeRequests.map((write) => write.ifMatch)).toEqual(['"w1-1"', '"w1-2"'])
  // Händelsen står kvar på sin plats när svaren kommit.
  await expect(eventBlock(page, 'Planering')).toContainText('14:00')
})

test('händelser i skrivskyddade kalendrar går inte att flytta', async ({ page }) => {
  const api = await openWeek(page)
  const block = eventBlock(page, 'Nationaldag')
  await expect(block).toBeVisible()
  const grab = await grabPoint(block)
  const dy = await pixelsBetween(page, '13:00', '16:00')

  await dragMouse(page, grab, { x: grab.x, y: grab.y + dy })

  await expect(block).toContainText('13:00')
  await page.waitForTimeout(300)
  expect(api.writeRequests).toEqual([])
})
