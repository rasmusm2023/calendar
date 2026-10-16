import { expect, type Page } from '@playwright/test'
import { signIn } from './auth.ts'
import {
  mockCalendarApi,
  stubGoogleIdentityServices,
  type CalendarApiMock,
  type FakeCalendar,
  type FakeEvent,
} from './google.ts'

export interface CalendarData {
  calendars: FakeCalendar[]
  events: Record<string, FakeEvent[]>
}

/** Loggar in, kopplar Google Calendar (riktiga Cloud Functions i emulatorn) och väntar på kalendern. */
export async function openCalendar(
  page: Page,
  data: CalendarData,
  setup?: (api: CalendarApiMock) => void,
) {
  await stubGoogleIdentityServices(page)
  const api = await mockCalendarApi(page, data)
  setup?.(api)

  await signIn(page)
  await page.getByRole('button', { name: 'Koppla Google Calendar' }).click()
  await expect(page.getByTestId('app-root')).toBeVisible()
  return api
}

/** En händelse i rutnätet, hittad på sin titel. Spöket som visas under en dragning räknas inte. */
export function eventBlock(page: Page, title: string) {
  return page.locator('.fc-event:not(.fc-event-mirror)', { hasText: title })
}

/** Mitt i en kolumn (idag) p� raden f�r ett klockslag ("HH:mm"), `offsetY` px under radens �verkant. */
export async function pointAt(page: Page, time: string, offsetY = 4) {
  const column = await page.locator('.fc-timegrid-col.fc-day-today').boundingBox()
  const lane = await page.locator(`.fc-timegrid-slot-lane[data-time="${time}:00"]`).boundingBox()
  if (!column || !lane) throw new Error(`Hittade inte rutn�tet vid ${time}`)
  return { x: column.x + column.width / 2, y: lane.y + offsetY }
}
