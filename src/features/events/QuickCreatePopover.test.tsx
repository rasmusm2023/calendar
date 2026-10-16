import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '@/i18n'
import type { EventTime } from '@/lib/google'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import type { CalendarInfo } from '@/types'
import { QuickCreatePopover, type QuickCreatePopoverProps } from './QuickCreatePopover'

const TZ = 'Europe/Stockholm'

const CALENDARS: CalendarInfo[] = [
  {
    id: 'work',
    name: 'Jobb',
    backgroundColor: TEST_CALENDAR_COLOR,
    selected: true,
    primary: true,
    accessRole: 'owner',
  },
  {
    id: 'private',
    name: 'Privat',
    backgroundColor: TEST_CALENDAR_COLOR,
    selected: true,
    primary: false,
    accessRole: 'writer',
  },
]

const TIMED: EventTime = {
  start: '2026-10-21T09:00:00+02:00',
  end: '2026-10-21T10:00:00+02:00',
  allDay: false,
}

async function renderPopover(props: Partial<QuickCreatePopoverProps> = {}) {
  const i18n = await createI18n('sv')
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const onChange = vi.fn()
  const anchor = { current: { getBoundingClientRect: () => new DOMRect(100, 100, 50, 30) } }
  render(
    <I18nextProvider i18n={i18n}>
      <QuickCreatePopover
        initial={TIMED}
        calendars={CALENDARS}
        initialCalendarId="work"
        timeZone={TZ}
        anchor={anchor}
        onChange={onChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...props}
      />
    </I18nextProvider>,
  )
  return { onSubmit, onCancel, onChange, user: userEvent.setup() }
}

describe('QuickCreatePopover', () => {
  it('öppnas som en namngiven dialog med titelfältet i fokus', async () => {
    await renderPopover()

    const dialog = await screen.findByRole('dialog', { name: 'Ny händelse' })
    expect(dialog).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveFocus()
  })

  it('fyller i tid och kalender från utkastet', async () => {
    await renderPopover({ initialCalendarId: 'private' })

    expect(await screen.findByLabelText('Startdatum')).toHaveValue('2026-10-21')
    expect(screen.getByLabelText('Starttid')).toHaveValue('09:00')
    expect(screen.getByLabelText('Slutdatum')).toHaveValue('2026-10-21')
    expect(screen.getByLabelText('Sluttid')).toHaveValue('10:00')
    expect(screen.getByRole('combobox', { name: 'Kalender' })).toHaveValue('private')
    expect(screen.getByRole('option', { name: 'Jobb' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Privat' })).toBeInTheDocument()
  })

  it('sparar med titel, tid och kalender', async () => {
    const { onSubmit, user } = await renderPopover()
    await user.type(await screen.findByRole('textbox', { name: 'Titel' }), '  Gympass ')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kalender' }), 'private')

    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      calendarId: 'private',
      title: 'Gympass',
      ...TIMED,
    })
  })

  it('sparar med Enter i titelfältet', async () => {
    const { onSubmit, user } = await renderPopover()

    await user.type(await screen.findByRole('textbox', { name: 'Titel' }), 'Möte{Enter}')

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Möte' }))
  })

  it('tillåter en händelse utan titel', async () => {
    const { onSubmit, user } = await renderPopover()

    await user.click(await screen.findByRole('button', { name: 'Spara' }))

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: '' }))
  })

  it('avbryter med Esc och med Avbryt', async () => {
    const { onCancel, onSubmit, user } = await renderPopover()
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('flyttar sluttiden lika mycket när starttiden ändras', async () => {
    const { onSubmit, user } = await renderPopover()
    const startTime = await screen.findByLabelText('Starttid')

    await user.clear(startTime)
    await user.type(startTime, '13:30')

    expect(screen.getByLabelText('Sluttid')).toHaveValue('14:30')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        start: '2026-10-21T13:30:00+02:00',
        end: '2026-10-21T14:30:00+02:00',
      }),
    )
  })

  it('sparar heldag med exklusivt slutdatum och döljer klockslagen', async () => {
    const { onSubmit, user } = await renderPopover()
    await user.click(await screen.findByRole('checkbox', { name: 'Heldag' }))

    expect(screen.queryByLabelText('Starttid')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sluttid')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, start: '2026-10-21', end: '2026-10-22' }),
    )
  })

  it('startar som heldag när utkastet är en heldag, med slutdatum inklusive', async () => {
    const { onSubmit, user } = await renderPopover({
      initial: { start: '2026-10-21', end: '2026-10-24', allDay: true },
    })

    expect(await screen.findByRole('checkbox', { name: 'Heldag' })).toBeChecked()
    expect(screen.getByLabelText('Slutdatum')).toHaveValue('2026-10-23')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2026-10-21', end: '2026-10-24', allDay: true }),
    )
  })

  it('varnar och stoppar sparande när slutet inte ligger efter början', async () => {
    const { onSubmit, user } = await renderPopover()
    const endTime = await screen.findByLabelText('Sluttid')

    await user.clear(endTime)
    await user.type(endTime, '08:00')

    expect(screen.getByRole('alert')).toHaveTextContent('slutet måste ligga efter början')
    expect(endTime).toBeInvalid()
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'x{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.clear(endTime)
    await user.type(endTime, '11:00')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara' })).toBeEnabled()
  })

  it('meddelar tid och kalender när de ändras, och null medan tiden är ogiltig', async () => {
    const { onChange, user } = await renderPopover()
    await screen.findByRole('dialog')
    expect(onChange).toHaveBeenLastCalledWith({ time: TIMED, calendarId: 'work' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Kalender' }), 'private')
    expect(onChange).toHaveBeenLastCalledWith({ time: TIMED, calendarId: 'private' })

    const endTime = screen.getByLabelText('Sluttid')
    await user.clear(endTime)
    expect(onChange).toHaveBeenLastCalledWith({ time: null, calendarId: 'private' })
  })
})
