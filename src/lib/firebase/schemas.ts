import { z } from 'zod'

/**
 * Zod-scheman för appens Firestore-dokument (PROJECT.md §4.2). Alla dokument valideras vid
 * läsning. Händelsedata finns aldrig här, och refresh token (`private/google`) hör bara hemma i
 * Cloud Functions och har därför inget klientschema.
 *
 * Fas 0 läser inga av dessa dokument ännu. Schemana är förberedda för Fas 1 och 2.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Förväntade färg som #rrggbb')

export const reminderSchema = z.object({
  method: z.enum(['popup', 'email']),
  minutes: z.number().int().min(0),
})
export type Reminder = z.infer<typeof reminderSchema>

/** users/{uid}/settings/{doc}. Saknade fält får standardvärden enligt PRD (måndag, 24 h). */
export const userSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  locale: z.enum(['sv', 'en']).default('sv'),
  timeZone: z.string().min(1).optional(),
  weekStartsOn: z.number().int().min(0).max(6).default(1),
  timeFormat: z.enum(['24h', '12h']).default('24h'),
  monthFilledBlocks: z.boolean().default(true),
  density: z.enum(['compact', 'comfortable']).default('comfortable'),
  activeSpaceIds: z.array(z.string()).default([]),
})
export type UserSettings = z.infer<typeof userSettingsSchema>

/** users/{uid}/spaces/{spaceId} */
export const spaceSchema = z.object({
  name: z.string().min(1),
  icon: z.string(),
  accentColor: hexColor,
  order: z.number().int(),
  defaultCalendarId: z.string().nullable().default(null),
  defaultReminders: z.array(reminderSchema).default([]),
  lastView: z.string().nullable().default(null),
})
export type Space = z.infer<typeof spaceSchema>

/** users/{uid}/calendarPrefs/{calendarId}. `accountId` är alltid "primary" i v1 (multi-konto i v2). */
export const calendarPrefsSchema = z.object({
  spaceId: z.string().nullable().default(null),
  defaultFamilyId: z.string().nullable().default(null),
  hidden: z.boolean().default(false),
  accountId: z.string().default('primary'),
})
export type CalendarPrefs = z.infer<typeof calendarPrefsSchema>

/** users/{uid}/families/{familyId} */
export const familySchema = z.object({
  name: z.string().min(1),
  color: hexColor,
  icon: z.string().optional(),
  spaceId: z.string(),
  style: z.enum(['filled', 'tinted', 'outline']).default('filled'),
  defaultReminders: z.array(reminderSchema).optional(),
  syncGoogleColor: z.boolean().default(false),
  order: z.number().int(),
})
export type Family = z.infer<typeof familySchema>

/** users/{uid}/familyRules/{ruleId} */
export const familyRuleSchema = z.object({
  familyId: z.string(),
  order: z.number().int(),
  enabled: z.boolean().default(true),
  match: z
    .object({
      field: z.enum(['title', 'location', 'calendar']),
      op: z.enum(['contains', 'startsWith', 'equals', 'regex']),
      value: z.string(),
      caseSensitive: z.boolean().default(false),
    })
    .refine(
      (match) => {
        if (match.op !== 'regex') return true
        try {
          new RegExp(match.value)
          return true
        } catch {
          return false
        }
      },
      { message: 'Ogiltigt reguljärt uttryck', path: ['value'] },
    ),
})
export type FamilyRule = z.infer<typeof familyRuleSchema>
