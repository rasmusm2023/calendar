import type { CalEvent, EventReminders } from '@/types'
import type { GoogleClient, RequestOptions } from './client'
import { GoogleApiError } from './errors'
import { mapGoogleEvent } from './mappers'
import { googleEventSchema } from './types'

/**
 * Skrivande anrop mot händelser (PROJECT.md §5.3, §5.4). Alla tar emot och returnerar våra egna typer.
 *
 * Om etag: `ifMatch` skickas som If-Match, och Google svarar 412 (`preconditionFailed`) om händelsen
 * ändrats sedan dess. Den som kör flera ändringar efter varandra på samma händelse (t.ex. två snabba
 * flyttar) måste ange etag från den senaste lyckade ändringen, inte från den som visades när användaren
 * började. Se `UndoManager`, som kör ändringar på samma händelse i ordning.
 */

/** Fält i svaret som vi använder. Samma som i `listEvents`, men för en enskild händelse. */
const EVENT_RESOURCE_FIELDS =
  'id,etag,status,summary,location,description,reminders,start,end,recurringEventId,extendedProperties/private'

export interface EventRef {
  calendarId: string
  eventId: string
}

/** Start och slut som i `CalEvent`: ISO med offset för tidsbestämd, rent datum för heldag (slut exklusivt). */
export interface EventTime {
  start: string
  end: string
  allDay: boolean
}

export interface NewEvent extends EventTime {
  calendarId: string
  /**
   * Id som skickas med till Google. Skapa det med `generateEventId()` innan första försöket: om
   * svaret går förlorat och ändringen skickas igen blir det ett 409 i stället för en dubblett, och
   * `insertEvent` hämtar då den redan skapade händelsen.
   */
  id: string
  title: string
  location?: string
  familyId?: string
  important?: boolean
}

/** Fält som ändras. Det som utelämnas rörs inte. `null` tar bort värdet. */
export interface EventChanges {
  title?: string
  /** Start, slut och heldag ändras alltid tillsammans, så att en händelse aldrig blir halvt heldag. */
  time?: EventTime
  location?: string | null
  description?: string | null
  /** Hela påminnelselistan ersätts. `{ useDefault: true }` ger kalenderns standardpåminnelser. */
  reminders?: EventReminders
  familyId?: string | null
  important?: boolean
}

export interface WriteOptions extends RequestOptions {
  /** Tidszon att använda om Google skickar lokal tid utan offset. */
  timeZone: string
}

export interface PatchOptions extends WriteOptions {
  /** Händelsens etag, skickas som If-Match. */
  etag?: string
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuv0123456789'
const ID_LENGTH = 26

/**
 * Nytt händelse-id. Google kräver tecknen a–v och 0–9 (base32hex, gemener) och 5–1024 tecken.
 * `randomBytes` byts ut i tester.
 */
export function generateEventId(
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  let id = ''
  for (const byte of randomBytes(ID_LENGTH)) id += ID_ALPHABET.charAt(byte % ID_ALPHABET.length)
  return id
}

function eventPath(ref: EventRef): string {
  return `/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.eventId)}`
}

function timeFields(time: EventTime, mode: 'insert' | 'patch') {
  if (time.allDay) {
    return {
      start: { date: time.start, ...(mode === 'patch' && { dateTime: null }) },
      end: { date: time.end, ...(mode === 'patch' && { dateTime: null }) },
    }
  }
  return {
    start: { dateTime: time.start, ...(mode === 'patch' && { date: null }) },
    end: { dateTime: time.end, ...(mode === 'patch' && { date: null }) },
  }
}

function parseEvent(raw: unknown, calendarId: string, timeZone: string): CalEvent {
  const parsed = googleEventSchema.safeParse(raw)
  if (!parsed.success) throw new GoogleApiError('badResponse')
  let event: CalEvent | null
  try {
    event = mapGoogleEvent(parsed.data, { calendarId, fallbackTimeZone: timeZone })
  } catch {
    throw new GoogleApiError('badResponse')
  }
  if (event === null) throw new GoogleApiError('badResponse')
  return event
}

function signalOption(options: RequestOptions): RequestOptions {
  return options.signal ? { signal: options.signal } : {}
}

export async function getEvent(
  client: GoogleClient,
  ref: EventRef,
  options: WriteOptions,
): Promise<CalEvent> {
  const raw = await client.getJson(
    eventPath(ref),
    { fields: EVENT_RESOURCE_FIELDS },
    signalOption(options),
  )
  return parseEvent(raw, ref.calendarId, options.timeZone)
}

/**
 * Skapar en händelse. Är det redan skapad (409, t.ex. efter ett förlorat svar) returneras den
 * befintliga händelsen, så att samma anrop kan göras om utan att det blir en dubblett.
 */
export async function insertEvent(
  client: GoogleClient,
  event: NewEvent,
  options: WriteOptions,
): Promise<CalEvent> {
  const privateProps: Record<string, string> = {}
  if (event.important === true) privateProps.scImportant = '1'
  if (event.familyId !== undefined) privateProps.scFamilyId = event.familyId

  const body = {
    id: event.id,
    summary: event.title,
    ...(event.location !== undefined && { location: event.location }),
    ...timeFields(event, 'insert'),
    ...(Object.keys(privateProps).length > 0 && { extendedProperties: { private: privateProps } }),
  }

  try {
    const raw = await client.requestJson(
      'POST',
      `/calendars/${encodeURIComponent(event.calendarId)}/events`,
      { params: { fields: EVENT_RESOURCE_FIELDS }, body, ...signalOption(options) },
    )
    return parseEvent(raw, event.calendarId, options.timeZone)
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === 'conflict') {
      return getEvent(client, { calendarId: event.calendarId, eventId: event.id }, options)
    }
    throw error
  }
}

/** Ändrar de angivna fälten (PATCH). Med `etag` svarar Google 412 om någon annan hunnit ändra händelsen. */
export async function patchEvent(
  client: GoogleClient,
  ref: EventRef,
  changes: EventChanges,
  options: PatchOptions,
): Promise<CalEvent> {
  const privateProps: Record<string, string | null> = {}
  if (changes.important !== undefined) privateProps.scImportant = changes.important ? '1' : null
  if (changes.familyId !== undefined) privateProps.scFamilyId = changes.familyId

  const body = {
    ...(changes.title !== undefined && { summary: changes.title }),
    ...(changes.location !== undefined && { location: changes.location }),
    ...(changes.description !== undefined && { description: changes.description }),
    ...(changes.reminders !== undefined && { reminders: changes.reminders }),
    ...(changes.time !== undefined && timeFields(changes.time, 'patch')),
    ...(Object.keys(privateProps).length > 0 && { extendedProperties: { private: privateProps } }),
  }

  const raw = await client.requestJson('PATCH', eventPath(ref), {
    params: { fields: EVENT_RESOURCE_FIELDS },
    body,
    ...(options.etag !== undefined && { ifMatch: options.etag }),
    ...signalOption(options),
  })
  return parseEvent(raw, ref.calendarId, options.timeZone)
}

export interface DeleteOptions extends RequestOptions {
  etag?: string
}

/**
 * Tar bort en händelse. En händelse som redan är borta (404 eller 410) räknas som lyckat, så att
 * samma borttagning kan göras om, och så att ångra av ett skapande inte fastnar.
 */
export async function deleteEvent(
  client: GoogleClient,
  ref: EventRef,
  options: DeleteOptions = {},
): Promise<void> {
  try {
    await client.requestJson('DELETE', eventPath(ref), {
      allowEmpty: true,
      ...(options.etag !== undefined && { ifMatch: options.etag }),
      ...signalOption(options),
    })
  } catch (error) {
    if (error instanceof GoogleApiError && (error.kind === 'notFound' || error.kind === 'gone')) {
      return
    }
    throw error
  }
}

/** Flyttar en händelse till en annan kalender (Googles `move`). Id:t behålls. */
export async function moveEvent(
  client: GoogleClient,
  ref: EventRef,
  destinationCalendarId: string,
  options: WriteOptions,
): Promise<CalEvent> {
  const raw = await client.requestJson('POST', `${eventPath(ref)}/move`, {
    params: { destination: destinationCalendarId, fields: EVENT_RESOURCE_FIELDS },
    ...signalOption(options),
  })
  return parseEvent(raw, destinationCalendarId, options.timeZone)
}
