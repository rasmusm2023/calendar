import { useEffect, useId, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { EventTime } from '@/lib/google'
import type { CalendarInfo } from '@/types'
import type { CreateEventInput } from './createEventCommand'
import { TimeFields } from './TimeFields'
import { useTimeForm } from './useTimeForm'

/** Det Radix behöver för att placera popovern: allt som kan mäta sin plats på skärmen. */
export interface PopoverAnchorTarget {
  getBoundingClientRect: () => DOMRect
}

export interface QuickCreateChange {
  /** Tiden som formuläret beskriver just nu, eller `null` medan den är ofullständig eller ogiltig. */
  time: EventTime | null
  calendarId: string
}

export interface QuickCreatePopoverProps {
  /** Tiden formuläret börjar med (från klicket eller dragningen i rutnätet). */
  initial: EventTime
  /** Kalendrar där användaren får skapa händelser. Minst en. */
  calendars: readonly CalendarInfo[]
  initialCalendarId: string
  timeZone: string
  /** Platsen popovern ska peka på, t.ex. utkastet i rutnätet. */
  anchor: RefObject<PopoverAnchorTarget | null>
  /** Anropas när tid eller kalender ändras, så att utkastet i rutnätet kan följa med. */
  onChange?: (change: QuickCreateChange) => void
  onSubmit: (event: CreateEventInput) => void
  onCancel: () => void
}

/**
 * Snabbpopovern för att skapa en händelse (PRD 6.3): titel, tid, heldag och kalender. Familj tillkommer med
 * familjerna i Fas 2. Den är öppen så länge den finns, så anroparen monterar den när ett utkast skapas
 * (med en ny `key` för varje utkast) och tar bort den vid `onSubmit` eller `onCancel`. Esc och klick utanför
 * avbryter.
 */
export function QuickCreatePopover({
  initial,
  calendars,
  initialCalendarId,
  timeZone,
  anchor,
  onChange,
  onSubmit,
  onCancel,
}: QuickCreatePopoverProps) {
  const { t } = useTranslation()
  const ids = { title: useId(), calendar: useId() }

  const [title, setTitle] = useState('')
  const [calendarId, setCalendarId] = useState(initialCalendarId)
  const timeForm = useTimeForm(initial, timeZone)
  const { time } = timeForm

  useEffect(() => {
    onChange?.({ time, calendarId })
  }, [time, calendarId, onChange])

  const submit = () => {
    if (time === null) return
    onSubmit({ calendarId, title: title.trim(), ...time })
  }

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="right"
        align="start"
        collisionPadding={8}
        aria-label={t('event.create.quick.dialog')}
        data-testid="quick-create"
      >
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={ids.title} className="sr-only">
              {t('event.create.quick.title')}
            </Label>
            <Input
              id={ids.title}
              value={title}
              placeholder={t('event.create.quick.titlePlaceholder')}
              autoComplete="off"
              onChange={(event) => {
                setTitle(event.target.value)
              }}
            />
          </div>

          <TimeFields {...timeForm} />

          <div className="grid gap-1.5">
            <Label htmlFor={ids.calendar}>{t('event.create.quick.calendar')}</Label>
            <NativeSelect
              id={ids.calendar}
              value={calendarId}
              onChange={(event) => {
                setCalendarId(event.target.value)
              }}
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('event.create.quick.cancel')}
            </Button>
            <Button type="submit" disabled={time === null}>
              {t('event.create.quick.save')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
