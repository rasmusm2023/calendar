import { localDateTimeToRfc3339, parseIsoInZone } from '@/lib/dates'
import type { CalendarInfo, CalEvent, EventReminders, Reminder } from '@/types'
import {
  googleCalendarListEntrySchema,
  googleCalendarListPageSchema,
  googleEventSchema,
  googleEventsPageSchema,
  type GoogleEvent,
  type GoogleEventTime,
  type GoogleReminder,
} from './types'

/** En post som inte gick att tolka. Posten hoppas över och problemet rapporteras, inte göms. */
export interface ParseIssue {
  index: number
  id?: string
  message: string
}

export interface CalendarsPage {
  calendars: CalendarInfo[]
  nextPageToken?: string
  issues: ParseIssue[]
}

export interface EventsPage {
  events: CalEvent[]
  nextPageToken?: string
  issues: ParseIssue[]
}

export interface MapEventContext {
  calendarId: string
  /** Tidszon att använda om Google skickar lokal tid utan offset och utan egen tidszon. */
  fallbackTimeZone: string
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function idOf(raw: unknown): string | undefined {
  if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string') {
    return raw.id
  }
  return undefined
}

function mapTime(
  time: GoogleEventTime,
  label: 'start' | 'end' | 'originalStartTime',
  ctx: MapEventContext,
): { value: string; allDay: boolean } {
  const { date, dateTime } = time
  if (date !== undefined && dateTime !== undefined) {
    throw new Error(`${label} har både date och dateTime`)
  }
  if (date !== undefined) {
    parseIsoInZone(date, 'UTC') // validerar formatet och att datumet finns
    return { value: date, allDay: true }
  }
  if (dateTime !== undefined) {
    if (HAS_OFFSET.test(dateTime)) {
      parseIsoInZone(dateTime, 'UTC') // validerar
      return { value: dateTime, allDay: false }
    }
    // Lokal tid utan offset: tolka i händelsens egen tidszon, annars i given reservtidszon.
    return {
      value: localDateTimeToRfc3339(dateTime, time.timeZone ?? ctx.fallbackTimeZone),
      allDay: false,
    }
  }
  throw new Error(`${label} saknar både date och dateTime`)
}

/** Påminnelser med en metod som appen hanterar (popup och e-post). Andra, t.ex. sms, släpps. */
function mapReminderList(list: readonly GoogleReminder[] | undefined): Reminder[] {
  const reminders: Reminder[] = []
  for (const { method, minutes } of list ?? []) {
    if (method === 'popup' || method === 'email') reminders.push({ method, minutes })
  }
  return reminders
}

function mapReminders(raw: GoogleEvent['reminders']): EventReminders | undefined {
  if (raw === undefined) return undefined
  if (raw.useDefault === true) return { useDefault: true }
  return { useDefault: false, overrides: mapReminderList(raw.overrides) }
}

/**
 * Googles händelse -> CalEvent. Returnerar null för avbokade händelser (de ska inte visas).
 * Kastar för händelser som saknar eller har inkonsekvent start/slut.
 */
export function mapGoogleEvent(raw: GoogleEvent, ctx: MapEventContext): CalEvent | null {
  if (raw.status === 'cancelled') {
    return null
  }
  if (!raw.start || !raw.end) {
    throw new Error('händelsen saknar start eller slut')
  }
  const start = mapTime(raw.start, 'start', ctx)
  const end = mapTime(raw.end, 'end', ctx)
  if (start.allDay !== end.allDay) {
    throw new Error('start och slut blandar heldag och tidsbestämd')
  }

  const appFields = raw.extendedProperties?.private
  const familyId = appFields?.scFamilyId
  const event: CalEvent = {
    id: raw.id,
    calendarId: ctx.calendarId,
    etag: raw.etag,
    title: raw.summary ?? '',
    start: start.value,
    end: end.value,
    allDay: start.allDay,
    important: appFields?.scImportant === '1',
  }
  if (raw.location !== undefined) event.location = raw.location
  if (raw.description !== undefined && raw.description !== '') event.description = raw.description
  const reminders = mapReminders(raw.reminders)
  if (reminders !== undefined) event.reminders = reminders
  if (raw.recurringEventId !== undefined) event.recurringEventId = raw.recurringEventId
  if (raw.originalStartTime !== undefined) {
    try {
      event.originalStart = mapTime(raw.originalStartTime, 'originalStartTime', ctx).value
    } catch {
      // En trasig ursprungstid ska inte stoppa hela händelsen. Den behövs bara för "denna och följande".
    }
  }
  if (raw.recurrence !== undefined) {
    event.recurrence = raw.recurrence
    // Tidszonen behövs bara för serier (huvudhändelsen), för att kunna skapa en ny serie i samma zon.
    if (raw.start.timeZone !== undefined) event.timeZone = raw.start.timeZone
  }
  if (familyId !== undefined && familyId !== '') event.familyId = familyId
  return event
}

/** Validerar och tolkar ett svar från events.list. Kastar (ZodError) om själva svaret är fel format. */
export function parseEventsPage(raw: unknown, ctx: MapEventContext): EventsPage {
  const page = googleEventsPageSchema.parse(raw)
  // Kalenderns egen tidszon är en bättre reserv än användarens när offset saknas.
  const itemCtx: MapEventContext = {
    ...ctx,
    fallbackTimeZone: page.timeZone ?? ctx.fallbackTimeZone,
  }

  const events: CalEvent[] = []
  const issues: ParseIssue[] = []
  page.items.forEach((item, index) => {
    const parsed = googleEventSchema.safeParse(item)
    if (!parsed.success) {
      issues.push({ index, id: idOf(item), message: parsed.error.message })
      return
    }
    try {
      const event = mapGoogleEvent(parsed.data, itemCtx)
      if (event) events.push(event)
    } catch (error) {
      issues.push({ index, id: parsed.data.id, message: describeError(error) })
    }
  })

  return {
    events,
    issues,
    ...(page.nextPageToken !== undefined && { nextPageToken: page.nextPageToken }),
  }
}

/**
 * Validerar och tolkar ett svar från calendarList.list. Raderade kalendrar utelämnas.
 * Kastar (ZodError) om själva svaret är fel format.
 */
export function parseCalendarListPage(raw: unknown): CalendarsPage {
  const page = googleCalendarListPageSchema.parse(raw)

  const calendars: CalendarInfo[] = []
  const issues: ParseIssue[] = []
  page.items.forEach((item, index) => {
    const parsed = googleCalendarListEntrySchema.safeParse(item)
    if (!parsed.success) {
      issues.push({ index, id: idOf(item), message: parsed.error.message })
      return
    }
    const entry = parsed.data
    if (entry.deleted === true) return

    const calendar: CalendarInfo = {
      id: entry.id,
      name: entry.summaryOverride ?? entry.summary ?? entry.id,
      backgroundColor: entry.backgroundColor.toLowerCase(),
      selected: entry.selected === true,
      primary: entry.primary === true,
      accessRole: entry.accessRole,
    }
    if (entry.timeZone !== undefined) calendar.timeZone = entry.timeZone
    if (entry.defaultReminders !== undefined) {
      calendar.defaultReminders = mapReminderList(entry.defaultReminders)
    }
    calendars.push(calendar)
  })

  return {
    calendars,
    issues,
    ...(page.nextPageToken !== undefined && { nextPageToken: page.nextPageToken }),
  }
}
