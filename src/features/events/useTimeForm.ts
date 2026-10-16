import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { EventTime } from '@/lib/google'
import {
  changeStart,
  eventTimeFromForm,
  formFromEventTime,
  type FormTimes,
} from './quickCreateForm'

export interface TimeForm {
  form: FormTimes
  setForm: Dispatch<SetStateAction<FormTimes>>
  /** Tiden som formuläret beskriver just nu, eller `null` medan den är ofullständig eller ogiltig. */
  time: EventTime | null
  /** Ändrar start och flyttar slutet lika mycket, så att längden behålls. */
  updateStart: (patch: Partial<Pick<FormTimes, 'startDate' | 'startTime'>>) => void
}

/** Tillstånd för formulärets tidsfält. Delas av snabbpopovern och redigeringspanelen. */
export function useTimeForm(initial: EventTime, timeZone: string): TimeForm {
  const [form, setForm] = useState<FormTimes>(() => formFromEventTime(initial, timeZone))
  const time = useMemo(() => eventTimeFromForm(form, timeZone), [form, timeZone])

  // Senaste giltiga tiden. Under redigering är ett fält ibland tomt, och då behövs den för att behålla längden.
  const lastValid = useRef<EventTime | null>(time)
  useEffect(() => {
    if (time !== null) lastValid.current = time
  }, [time])

  const updateStart: TimeForm['updateStart'] = (patch) => {
    const reference = lastValid.current
    setForm((current) => changeStart(current, patch, timeZone, reference))
  }

  return { form, setForm, time, updateStart }
}
