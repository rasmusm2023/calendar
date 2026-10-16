import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { CalendarInfo, CalEvent, EventReminders } from '@/types'
import { remindersOf, sameReminders, type EventEdit } from './eventEdit'
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog'
import { isRecurringInstance, type RecurringScope } from './recurringScope'
import { ReminderEditor } from './ReminderEditor'
import { TimeFields } from './TimeFields'
import { useTimeForm } from './useTimeForm'

/** Varför en händelse inte går att ändra. */
export type EventReadOnlyReason = 'calendar'

export interface EventEditPanelProps {
  event: CalEvent
  /** Kalendern händelsen ligger i. Ger namn och standardpåminnelser. */
  calendar: CalendarInfo | undefined
  /** Satt när händelsen bara går att titta på. Då visas fälten låsta och utan spara-knapp. */
  readOnlyReason?: EventReadOnlyReason
  timeZone: string
  /**
   * Anropas med bara de fält som ändrats. Anropas inte om inget ändrats. För en förekomst av en återkommande
   * händelse frågar panelen först vad ändringen gäller, och `scope` är svaret. För andra händelser är den `this`.
   */
  onSave: (edit: EventEdit, scope: RecurringScope) => void
  /**
   * Tar bort händelsen. Utan den visas ingen Ta bort-knapp. Osparade ändringar i panelen kastas. `scope` är som
   * för `onSave`.
   */
  onDelete?: (scope: RecurringScope) => void
  /** Duplicerar händelsen som den var när panelen öppnades. Utan den visas ingen Duplicera-knapp. */
  onDuplicate?: () => void
  onClose: () => void
}

/**
 * Redigeringspanelen för en befintlig händelse (PRD 6.5): titel, tid, heldag, plats, beskrivning och påminnelser.
 * Kalendern visas men byts inte här. Familj och "viktig" tillkommer i Fas 2.
 * Är händelsen en förekomst av en återkommande händelse frågar panelen vad Spara och Ta bort gäller (PRD 6.7).
 * Frågan ligger över panelen, så att det man skrivit finns kvar om man ångrar sig.
 *
 * Panelen utgår från händelsen som den såg ut när den öppnades (anroparen ger den en ny `key` per händelse), så
 * en uppdatering från Google medan man skriver skriver inte över det man redan skrivit. Spara skickar bara de
 * fält som skiljer sig från början.
 */
export function EventEditPanel({
  event,
  calendar,
  readOnlyReason,
  timeZone,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
}: EventEditPanelProps) {
  const { t } = useTranslation()
  const ids = { title: useId(), location: useId(), notes: useId() }
  const readOnly = readOnlyReason !== undefined

  const [initial] = useState(event)
  const [title, setTitle] = useState(initial.title)
  const [location, setLocation] = useState(initial.location ?? '')
  const [notes, setNotes] = useState(initial.description ?? '')
  const [reminders, setReminders] = useState<EventReminders>(() => remindersOf(initial))
  const timeForm = useTimeForm(
    { start: initial.start, end: initial.end, allDay: initial.allDay },
    timeZone,
  )
  const { time } = timeForm
  const recurring = isRecurringInstance(initial)
  /** Det som väntar på svar på frågan om vad ändringen gäller. */
  const [asking, setAsking] = useState<
    { kind: 'save'; edit: EventEdit } | { kind: 'delete' } | null
  >(null)

  const save = (edit: EventEdit, scope: RecurringScope) => {
    onSave(edit, scope)
    onClose()
  }

  const remove = (scope: RecurringScope) => {
    onDelete?.(scope)
    onClose()
  }

  const submit = () => {
    if (readOnly) return
    if (time === null) return
    const edit: EventEdit = {}
    if (title.trim() !== initial.title) edit.title = title.trim()
    if (location.trim() !== (initial.location ?? '')) edit.location = location.trim()
    if (notes !== (initial.description ?? '')) edit.description = notes
    if (
      time.start !== initial.start ||
      time.end !== initial.end ||
      time.allDay !== initial.allDay
    ) {
      edit.time = time
    }
    if (!sameReminders(reminders, remindersOf(initial))) edit.reminders = reminders

    if (Object.keys(edit).length === 0) onClose()
    else if (recurring) setAsking({ kind: 'save', edit })
    else save(edit, 'this')
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent data-testid="event-edit">
        <SheetTitle>{t(readOnly ? 'event.edit.viewDialog' : 'event.edit.dialog')}</SheetTitle>
        <SheetDescription>{t('event.edit.intro')}</SheetDescription>

        {readOnlyReason !== undefined && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {t(`event.edit.readOnly.${readOnlyReason}`)}
          </p>
        )}

        <form
          className="grid gap-4"
          noValidate
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            submit()
          }}
        >
          <fieldset disabled={readOnly} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.title}>{t('event.edit.title')}</Label>
              <Input
                id={ids.title}
                value={title}
                placeholder={t('event.edit.titlePlaceholder')}
                autoComplete="off"
                onChange={(changeEvent) => {
                  setTitle(changeEvent.target.value)
                }}
              />
            </div>

            <TimeFields {...timeForm} />

            <div className="grid gap-1.5">
              <Label htmlFor={ids.location}>{t('event.edit.location')}</Label>
              <Input
                id={ids.location}
                value={location}
                autoComplete="off"
                onChange={(changeEvent) => {
                  setLocation(changeEvent.target.value)
                }}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={ids.notes}>{t('event.edit.notes')}</Label>
              <Textarea
                id={ids.notes}
                value={notes}
                rows={4}
                onChange={(changeEvent) => {
                  setNotes(changeEvent.target.value)
                }}
              />
            </div>

            <ReminderEditor
              value={reminders}
              defaults={calendar?.defaultReminders ?? []}
              onChange={setReminders}
            />
          </fieldset>

          {calendar !== undefined && (
            <p className="text-sm text-muted-foreground">
              {t('event.edit.calendar')}: {calendar.name}
            </p>
          )}

          {/* Fast i nederkanten, så att Spara alltid syns även när panelen måste rullas. */}
          <div className="sticky -bottom-6 -mx-6 -mb-6 flex justify-end gap-2 border-t bg-background px-6 py-3">
            <div className="mr-auto flex gap-2">
              {onDuplicate !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onDuplicate()
                    onClose()
                  }}
                >
                  {t('event.edit.duplicate')}
                </Button>
              )}
              {onDelete !== undefined && !readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => {
                    if (recurring) setAsking({ kind: 'delete' })
                    else remove('this')
                  }}
                >
                  {t('event.edit.delete')}
                </Button>
              )}
            </div>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t(readOnly ? 'event.edit.close' : 'event.edit.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={time === null}>
                {t('event.edit.save')}
              </Button>
            )}
          </div>
        </form>

        {asking !== null && (
          <RecurrenceScopeDialog
            mode={asking.kind === 'save' ? 'edit' : 'delete'}
            onConfirm={(scope) => {
              if (asking.kind === 'save') save(asking.edit, scope)
              else remove(scope)
            }}
            onCancel={() => {
              setAsking(null)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
