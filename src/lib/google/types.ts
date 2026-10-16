import { z } from 'zod'

/**
 * Zod-scheman för Google Calendar API v3. Data från Google valideras alltid vid gränsen
 * (PROJECT.md §7). Schemana beskriver bara de fält appen använder. Okända fält tas bort.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Förväntade färg som #rrggbb')

/**
 * En påminnelse. Metoden är en vanlig sträng här: Google kan ha andra (t.ex. `sms`) som appen inte hanterar,
 * och de ska inte göra att hela händelsen eller kalendern avvisas. Mappern släpper dem.
 */
export const googleReminderSchema = z.object({
  method: z.string(),
  minutes: z.number().int().min(0),
})
export type GoogleReminder = z.infer<typeof googleReminderSchema>

// ---- calendarList ----------------------------------------------------------------------------

export const googleCalendarListEntrySchema = z.object({
  id: z.string().min(1),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  // Med colorRgbFormat=true är detta alltid en hex-färg.
  backgroundColor: hexColor,
  foregroundColor: hexColor.optional(),
  // Google utelämnar booleans som är false.
  selected: z.boolean().optional(),
  primary: z.boolean().optional(),
  deleted: z.boolean().optional(),
  // Okänd framtida roll behandlas försiktigt som skrivskyddad.
  accessRole: z.enum(['freeBusyReader', 'reader', 'writer', 'owner']).catch('reader'),
  timeZone: z.string().optional(),
  defaultReminders: z.array(googleReminderSchema).optional(),
})
export type GoogleCalendarListEntry = z.infer<typeof googleCalendarListEntrySchema>

// ---- events ----------------------------------------------------------------------------------

const googleEventTimeSchema = z.object({
  /** Heldag: "YYYY-MM-DD". */
  date: z.string().optional(),
  /** Tidsbestämd: RFC 3339. */
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
})
export type GoogleEventTime = z.infer<typeof googleEventTimeSchema>

export const googleEventSchema = z.object({
  id: z.string().min(1),
  etag: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  reminders: z
    .object({
      useDefault: z.boolean().optional(),
      overrides: z.array(googleReminderSchema).optional(),
    })
    .optional(),
  // Saknas på avbokade händelser.
  start: googleEventTimeSchema.optional(),
  end: googleEventTimeSchema.optional(),
  recurringEventId: z.string().optional(),
  extendedProperties: z
    .object({
      private: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})
export type GoogleEvent = z.infer<typeof googleEventSchema>

// ---- sidor (paginering) ----------------------------------------------------------------------

/**
 * Själva sidan valideras strikt, men objekten i `items` hålls som `unknown` så att en enskild
 * trasig post inte får tappa resten av sidan. Varje post valideras för sig (se mappers.ts).
 */
export const googleCalendarListPageSchema = z.object({
  items: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
})

export const googleEventsPageSchema = z.object({
  items: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
  /** Kalenderns tidszon. */
  timeZone: z.string().optional(),
})
