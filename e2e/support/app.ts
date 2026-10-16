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

/** En händelse i rutnätet, hittad på sin titel. */
export function eventBlock(page: Page, title: string) {
  return page.locator('.fc-event', { hasText: title })
}
