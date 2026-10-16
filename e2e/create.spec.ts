import { expect, test, type Page } from '@playwright/test'
import { eventBlock, openCalendar, pointAt } from './support/app.ts'
import { clearAuthAccounts } from './support/auth.ts'
import { fakeGoogle, zonedTime, type CalendarApiMock, type FakeCalendar } from './support/google.ts'

const CALENDARS: FakeCalendar[] = [
  { id: 'work', name: 'Jobb', color: '#e11d48', selected: true, primary: true },
  { id: 'private', name: 'Privat', color: '#2563eb', selected: true },
  { id: 'other', name: 'Övrigt', color: '#16a34a', selected: false },
]

test.beforeEach(async ({ request }) => {
  await clearAuthAccounts(request)
  await fakeGoogle.reset(request)
})

/** Öppnar veckan med klockan fast på 10:00, så att rutnätet scrollar till 09:00 och förmiddagen syns. */
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
      },
    },
    setup,
  )
  await expect(eventBlock(page, 'Planering')).toBeVisible()
  return api
}

/** Klickar på ett klockslag idag och väntar tills popovern är öppen och titelfältet har fokus (så att inget som skrivs går förlorat). */
async function clickToCreate(page: Page, time: string) {
  const point = await pointAt(page, time)
  await page.mouse.click(point.x, point.y)
  await expect(dialog(page).getByRole('textbox', { name: 'Titel' })).toBeFocused()
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Ny händelse' })
}

test('klicka i rutnätet, skriv en titel och spara med Enter', async ({ page }) => {
  const api = await openWeek(page)

  const point = await pointAt(page, '11:00')
  await page.mouse.click(point.x, point.y)

  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('textbox', { name: 'Titel' })).toBeFocused()
  // Utkastet syns i rutnätet, i huvudkalenderns färg.
  await expect(page.locator('.sc-draft')).toBeVisible()
  await expect(page.locator('.sc-draft')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await expect(dialog(page).getByLabel('Starttid')).toHaveValue('11:00')
  await expect(dialog(page).getByLabel('Sluttid')).toHaveValue('12:00')

  await page.keyboard.type('Gympass')
  await page.keyboard.press('Enter')

  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.sc-draft')).toHaveCount(0)
  await expect(eventBlock(page, 'Gympass')).toBeVisible()
  await expect(eventBlock(page, 'Gympass')).toHaveCSS('background-color', 'rgb(225, 29, 72)')

  // Skickat till Google med eget id, rätt kalender och rätt tid.
  await expect.poll(() => api.writeRequests.length).toBe(1)
  const [write] = api.writeRequests
  expect(write.method).toBe('POST')
  expect(write.path).toBe('/calendars/work/events')
  expect(write.body).toMatchObject({
    id: expect.stringMatching(/^[a-v0-9]{26}$/),
    summary: 'Gympass',
    start: { dateTime: zonedTime(0, '11:00') },
    end: { dateTime: zonedTime(0, '12:00') },
  })

  // Händelsen finns kvar efter omladdning: den kom från "Google", inte bara från cachen.
  await page.reload()
  await expect(eventBlock(page, 'Gympass')).toBeVisible()
})

test('dra i rutnätet för att välja tid, med snäppning till 15 minuter', async ({ page }) => {
  const api = await openWeek(page)

  const from = await pointAt(page, '11:00')
  const to = await pointAt(page, '13:00')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, (from.y + to.y) / 2, { steps: 5 })
  await page.mouse.move(to.x, to.y, { steps: 5 })
  // Markeringen syns medan man drar.
  await expect(page.locator('.fc-highlight')).toBeVisible()
  await page.mouse.up()

  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByLabel('Starttid')).toHaveValue('11:00')
  await expect(dialog(page).getByLabel('Sluttid')).toHaveValue('13:15')
  // Markeringen har ersatts av utkastet.
  await expect(page.locator('.fc-highlight')).toHaveCount(0)
  await expect(page.locator('.sc-draft')).toBeVisible()
  await expect(dialog(page).getByRole('textbox', { name: 'Titel' })).toBeFocused()

  await page.keyboard.type('Workshop')
  await dialog(page).getByRole('button', { name: 'Spara' }).click()

  await expect(eventBlock(page, 'Workshop')).toBeVisible()
  await expect.poll(() => api.writeRequests.length).toBe(1)
  expect(api.writeRequests[0]?.body).toMatchObject({
    start: { dateTime: zonedTime(0, '11:00') },
    end: { dateTime: zonedTime(0, '13:15') },
  })
})

test('Esc och klick utanför avbryter utan att skicka något', async ({ page }) => {
  const api = await openWeek(page)

  const point = await pointAt(page, '11:00')
  await page.mouse.click(point.x, point.y)
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.sc-draft')).toHaveCount(0)

  await page.mouse.click(point.x, point.y)
  await expect(dialog(page)).toBeVisible()
  await page.getByTestId('calendar-title').click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.sc-draft')).toHaveCount(0)

  expect(api.writeRequests).toEqual([])
})

test('ett nytt klick flyttar utkastet i stället för att lägga till ett till', async ({ page }) => {
  await openWeek(page)

  await page.mouse.click((await pointAt(page, '11:00')).x, (await pointAt(page, '11:00')).y)
  await expect(dialog(page).getByLabel('Starttid')).toHaveValue('11:00')

  const later = await pointAt(page, '15:00')
  await page.mouse.click(later.x, later.y)

  await expect(dialog(page).getByLabel('Starttid')).toHaveValue('15:00')
  await expect(page.locator('.sc-draft')).toHaveCount(1)
  await expect(dialog(page)).toHaveCount(1)
})

test('att ändra tiden i popovern flyttar utkastet i rutnätet', async ({ page }) => {
  await openWeek(page)
  const point = await pointAt(page, '11:00')
  await page.mouse.click(point.x, point.y)
  const draftTop = async () => (await page.locator('.sc-draft').boundingBox())?.y ?? 0
  const before = await draftTop()

  await dialog(page).getByLabel('Starttid').fill('14:00')

  await expect.poll(draftTop).toBeGreaterThan(before)
  await expect(dialog(page).getByLabel('Sluttid')).toHaveValue('15:00')
})

test('heldag: klick på en dag i månadsvyn skapar en heldagshändelse', async ({ page }) => {
  const api = await openWeek(page)
  await page.getByRole('group', { name: 'Vy' }).getByRole('button', { name: 'Månad' }).click()
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible()

  await page.locator('.fc-daygrid-day.fc-day-today').click({ position: { x: 20, y: 60 } })

  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('checkbox', { name: 'Heldag' })).toBeChecked()
  await expect(dialog(page).getByRole('textbox', { name: 'Titel' })).toBeFocused()
  await page.keyboard.type('Semester')
  await page.keyboard.press('Enter')

  await expect(eventBlock(page, 'Semester')).toBeVisible()
  await expect.poll(() => api.writeRequests.length).toBe(1)
  const today = zonedTime(0, '00:00').slice(0, 10)
  const tomorrow = zonedTime(1, '00:00').slice(0, 10)
  expect(api.writeRequests[0]?.body).toMatchObject({
    start: { date: today },
    end: { date: tomorrow },
  })
})

test('knappen Ny händelse går att använda med tangentbordet', async ({ page }) => {
  const api = await openWeek(page)

  await page.getByRole('button', { name: 'Ny händelse' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  // Klockan är fast på 10:00, så förslaget är nästa hela timme.
  await expect(dialog(page).getByLabel('Starttid')).toHaveValue('11:00')
  await expect(dialog(page).getByRole('textbox', { name: 'Titel' })).toBeFocused()

  await page.keyboard.type('Möte')
  await page.keyboard.press('Enter')

  await expect(eventBlock(page, 'Möte')).toBeVisible()
  await expect.poll(() => api.writeRequests.length).toBe(1)
})

test('skapa i en släckt kalender tänder den, så att händelsen syns', async ({ page }) => {
  await openWeek(page)
  await expect(page.getByRole('checkbox', { name: 'Övrigt' })).not.toBeChecked()

  await clickToCreate(page, '11:00')
  await dialog(page).getByRole('combobox', { name: 'Kalender' }).selectOption('other')
  // Utkastet byter till vald kalenders färg direkt.
  await expect(page.locator('.sc-draft')).toHaveCSS('background-color', 'rgb(22, 163, 74)')
  await page.keyboard.type('Utflykt')
  await dialog(page).getByRole('button', { name: 'Spara' }).click()

  await expect(page.getByRole('checkbox', { name: 'Övrigt' })).toBeChecked()
  await expect(eventBlock(page, 'Utflykt')).toBeVisible()
})

test('misslyckas sparandet rullas händelsen tillbaka med ett tydligt felmeddelande', async ({
  page,
}) => {
  const api = await openWeek(page, (mock) => {
    mock.failWrites = { status: 403, reason: 'forbidden' }
  })

  await clickToCreate(page, '11:00')
  await page.keyboard.type('Gympass')
  await page.keyboard.press('Enter')

  const toast = page.getByText('Kunde inte spara: Ny händelse: Gympass')
  await expect(toast).toBeVisible()
  await expect(eventBlock(page, 'Gympass')).toHaveCount(0)

  // Försök igen efter att felet försvunnit: samma id skickas, så ingen dubblett kan uppstå.
  api.failWrites = null
  await page.getByRole('button', { name: 'Försök igen' }).click()
  await expect(eventBlock(page, 'Gympass')).toBeVisible()
  const ids = api.writeRequests.map((write) => (write.body as { id: string }).id)
  expect(ids).toHaveLength(2)
  expect(ids[0]).toBe(ids[1])
})

test('ångra från toasten tar bort händelsen igen', async ({ page }) => {
  const api = await openWeek(page)

  await clickToCreate(page, '11:00')
  await page.keyboard.type('Gympass')
  await page.keyboard.press('Enter')
  await expect(eventBlock(page, 'Gympass')).toBeVisible()

  await page.getByRole('button', { name: 'Ångra' }).click()

  await expect(eventBlock(page, 'Gympass')).toHaveCount(0)
  await expect
    .poll(() => api.writeRequests.map((write) => write.method))
    .toEqual(['POST', 'DELETE'])
  expect(api.events.work.some((event) => event.title === 'Gympass')).toBe(false)
})
