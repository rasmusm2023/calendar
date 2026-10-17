/** Dataset-nycklar som rutnätet sätter på varje händelse, så att kortkommandon kan hitta den utan FullCalendar. */
export const EVENT_CALENDAR_DATASET = 'scCalendarId'
export const EVENT_ID_DATASET = 'scEventId'

export interface GridEventRef {
  calendarId: string
  eventId: string
}

/** Händelsen som ett fokuserat element tillhör, eller `null` om fokus inte ligger i en händelse. */
export function eventRefFromTarget(target: EventTarget | null): GridEventRef | null {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>('.fc-event')
  if (element === null) return null
  const calendarId = element.dataset[EVENT_CALENDAR_DATASET]
  const eventId = element.dataset[EVENT_ID_DATASET]
  if (calendarId === undefined || eventId === undefined || calendarId === '' || eventId === '') {
    return null
  }
  return { calendarId, eventId }
}

/** Flyttar fokus till händelsen i rutnätet. Returnerar false om den inte är ritad just nu. */
export function focusCalendarEvent(root: ParentNode, ref: GridEventRef): boolean {
  for (const element of root.querySelectorAll<HTMLElement>('.fc-event')) {
    if (
      element.dataset[EVENT_CALENDAR_DATASET] === ref.calendarId &&
      element.dataset[EVENT_ID_DATASET] === ref.eventId
    ) {
      element.focus()
      return document.activeElement === element
    }
  }
  return false
}

/**
 * Samma som `focusCalendarEvent`, men efter att en dialog hunnit släppa fokus. Radix återställer fokus
 * när dialogen stängs, och den noden kan redan vara borta (rutnätet ritar om händelsen).
 */
export function focusCalendarEventSoon(root: ParentNode, ref: GridEventRef): void {
  requestAnimationFrame(() => {
    focusCalendarEvent(root, ref)
  })
}
