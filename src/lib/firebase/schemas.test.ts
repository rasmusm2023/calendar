import { describe, expect, it } from 'vitest'
import {
  calendarPrefsSchema,
  familyRuleSchema,
  familySchema,
  reminderSchema,
  spaceSchema,
  userSettingsSchema,
} from './schemas'

describe('userSettingsSchema', () => {
  it('ger PRD:s standardvärden för ett tomt dokument (måndag, 24 h, fyllda block)', () => {
    expect(userSettingsSchema.parse({})).toEqual({
      theme: 'system',
      locale: 'sv',
      weekStartsOn: 1,
      timeFormat: '24h',
      monthFilledBlocks: true,
      density: 'comfortable',
      activeSpaceIds: [],
    })
  })

  it('avvisar ogiltiga värden', () => {
    expect(userSettingsSchema.safeParse({ weekStartsOn: 7 }).success).toBe(false)
    expect(userSettingsSchema.safeParse({ theme: 'neon' }).success).toBe(false)
    expect(userSettingsSchema.safeParse({ locale: 'de' }).success).toBe(false)
  })
})

describe('reminderSchema', () => {
  it('kräver känd metod och icke-negativa heltalsminuter', () => {
    expect(reminderSchema.safeParse({ method: 'popup', minutes: 30 }).success).toBe(true)
    expect(reminderSchema.safeParse({ method: 'sms', minutes: 30 }).success).toBe(false)
    expect(reminderSchema.safeParse({ method: 'popup', minutes: -1 }).success).toBe(false)
    expect(reminderSchema.safeParse({ method: 'popup', minutes: 1.5 }).success).toBe(false)
  })
})

describe('spaceSchema', () => {
  const space = { name: 'Work', icon: '💼', accentColor: '#3366ff', order: 0 }

  it('fyller i standardvärden', () => {
    expect(spaceSchema.parse(space)).toEqual({
      ...space,
      defaultCalendarId: null,
      defaultReminders: [],
      lastView: null,
    })
  })

  it('avvisar tomt namn och ogiltig färg', () => {
    expect(spaceSchema.safeParse({ ...space, name: '' }).success).toBe(false)
    expect(spaceSchema.safeParse({ ...space, accentColor: 'blue' }).success).toBe(false)
    expect(spaceSchema.safeParse({ ...space, accentColor: '#36f' }).success).toBe(false)
  })
})

describe('calendarPrefsSchema', () => {
  it('använder "primary" som konto i v1 och visar kalendern som standard', () => {
    expect(calendarPrefsSchema.parse({})).toEqual({
      spaceId: null,
      defaultFamilyId: null,
      hidden: false,
      accountId: 'primary',
    })
  })
})

describe('familySchema', () => {
  const family = { name: 'Träning', color: '#16a765', spaceId: 's1', order: 0 }

  it('fyller i standardstil och avstängd Google-färgsynk', () => {
    expect(familySchema.parse(family)).toMatchObject({ style: 'filled', syncGoogleColor: false })
  })

  it('avvisar ogiltig färg och okänd stil', () => {
    expect(familySchema.safeParse({ ...family, color: 'green' }).success).toBe(false)
    expect(familySchema.safeParse({ ...family, style: 'neon' }).success).toBe(false)
  })
})

describe('familyRuleSchema', () => {
  const rule = (match: Record<string, unknown>) => ({
    familyId: 'f1',
    order: 0,
    match: { field: 'title', op: 'contains', value: 'gym', ...match },
  })

  it('tolkar en enkel regel med standardvärden', () => {
    expect(familyRuleSchema.parse(rule({}))).toMatchObject({
      enabled: true,
      match: { caseSensitive: false },
    })
  })

  it('godkänner giltigt och avvisar ogiltigt reguljärt uttryck', () => {
    expect(familyRuleSchema.safeParse(rule({ op: 'regex', value: '^gym(nastik)?$' })).success).toBe(
      true,
    )
    expect(familyRuleSchema.safeParse(rule({ op: 'regex', value: '([' })).success).toBe(false)
  })

  it('kontrollerar inte regex-syntax för andra operatorer', () => {
    expect(familyRuleSchema.safeParse(rule({ op: 'contains', value: '([' })).success).toBe(true)
  })

  it('avvisar okänt fält', () => {
    expect(familyRuleSchema.safeParse(rule({ field: 'attendees' })).success).toBe(false)
  })
})
