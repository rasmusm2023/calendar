import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { EventTime } from '@/lib/google'
import type { CalendarInfo } from '@/types'
import type { CreateEventInput } from './createEventCommand'
import {
  changeStart,
  eventTimeFromForm,
  formFromEventTime,
  type FormTimes,
} from './quickCreateForm'

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
  const ids = {
    title: useId(),
    startDate: useId(),
    startTime: useId(),
    endDate: useId(),
    endTime: useId(),
    calendar: useId(),
    allDay: useId(),
    error: useId(),
  }

  const [title, setTitle] = useState('')
  const [calendarId, setCalendarId] = useState(initialCalendarId)
  const [form, setForm] = useState<FormTimes>(() => formFromEventTime(initial, timeZone))

  const time = useMemo(() => eventTimeFromForm(form, timeZone), [form, timeZone])
  // Senaste giltiga tiden. Under redigering är ett fält ibland tomt, och då behövs den för att behålla längden.
  const lastValid = useRef<EventTime | null>(time)
  useEffect(() => {
    if (time !== null) lastValid.current = time
  }, [time])

  useEffect(() => {
    onChange?.({ time, calendarId })
  }, [time, calendarId, onChange])

  const updateStart = (patch: Partial<Pick<FormTimes, 'startDate' | 'startTime'>>) => {
    const reference = lastValid.current
    setForm((current) => changeStart(current, patch, timeZone, reference))
  }

  const submit = () => {
    if (time === null) return
    onSubmit({ calendarId, title: title.trim(), ...time })
  }

  const invalid = time === null
  const timeFields = (
    <>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.startDate}>{t('event.create.quick.startDate')}</Label>
          <Input
            id={ids.startDate}
            type="date"
            required
            value={form.startDate}
            onChange={(event) => {
              updateStart({ startDate: event.target.value })
            }}
          />
        </div>
        {!form.allDay && (
          <div className="grid gap-1.5">
            <Label htmlFor={ids.startTime}>{t('event.create.quick.startTime')}</Label>
            <Input
              id={ids.startTime}
              type="time"
              required
              value={form.startTime}
              onChange={(event) => {
                updateStart({ startTime: event.target.value })
              }}
            />
          </div>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.endDate}>{t('event.create.quick.endDate')}</Label>
          <Input
            id={ids.endDate}
            type="date"
            required
            aria-invalid={invalid}
            aria-describedby={invalid ? ids.error : undefined}
            value={form.endDate}
            onChange={(event) => {
              setForm((current) => ({ ...current, endDate: event.target.value }))
            }}
          />
        </div>
        {!form.allDay && (
          <div className="grid gap-1.5">
            <Label htmlFor={ids.endTime}>{t('event.create.quick.endTime')}</Label>
            <Input
              id={ids.endTime}
              type="time"
              required
              aria-invalid={invalid}
              aria-describedby={invalid ? ids.error : undefined}
              value={form.endTime}
              onChange={(event) => {
                setForm((current) => ({ ...current, endTime: event.target.value }))
              }}
            />
          </div>
        )}
      </div>
    </>
  )

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

          <div className="flex items-center gap-2">
            <input
              id={ids.allDay}
              type="checkbox"
              className="size-4 accent-primary"
              checked={form.allDay}
              onChange={(event) => {
                setForm((current) => ({ ...current, allDay: event.target.checked }))
              }}
            />
            <Label htmlFor={ids.allDay}>{t('event.create.quick.allDay')}</Label>
          </div>

          {timeFields}

          {invalid && (
            <p id={ids.error} role="alert" className="text-sm text-destructive">
              {t('event.create.quick.invalidTime')}
            </p>
          )}

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
            <Button type="submit" disabled={invalid}>
              {t('event.create.quick.save')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
