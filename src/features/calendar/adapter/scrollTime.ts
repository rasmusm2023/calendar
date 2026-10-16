const PAD = 2

/**
 * Tiden som tidsrutnätet ska scrolla till för att visa "nu": en timme före aktuell tid (hela timmar), så
 * att det som just hänt och det som kommer syns. Det här är webbläsarens lokala tid, som kalendern visar.
 */
export function scrollTimeForNow(now: Date): string {
  const hour = Math.max(0, now.getHours() - 1)
  return `${String(hour).padStart(PAD, '0')}:00:00`
}
