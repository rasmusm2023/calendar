import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '@/i18n'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import type { CalendarInfo, CalEvent } from '@/types'
import { EventEditPanel, type EventEditPanelProps } from './EventEditPanel'

const TZ = 'Europe/Stockholm'

const CALENDAR: CalendarInfo = {
  id: 'work',
  name: 'Jobb',
  backgroundColor: TEST_CALENDAR_COLOR,
  selected: true,
  primary: true,
  accessRole: 'owner',
  defaultReminders: [{ method: 'popup', minutes: 30 }],
}

const EVENT: CalEvent = {
  id: 'e1',
  calendarId: 'work',
  etag: '"1"',
  title: 'Planering',
  start: '2026-10-21T09:00:00+02:00',
  end: '2026-10-21T10:00:00+02:00',
  allDay: false,
  location: 'Rum 4',
  description: 'Ta med kaffe',
  important: false,
}

async function renderPanel(props: Partial<EventEditPanelProps> = {}) {
  const i18n = await createI18n('sv')
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <EventEditPanel
        event={EVENT}
        calendar={CALENDAR}
        timeZone={TZ}
        onSave={onSave}
        onClose={onClose}
        {...props}
      />
    </I18nextProvider>,
  )
  return { onSave, onClose, user: userEvent.setup() }
}

describe('EventEditPanel', () => {
  it('visar händelsens uppgifter i en namngiven dialog', async () => {
    await renderPanel()

    expect(await screen.findByRole('dialog', { name: 'Redigera händelse' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveValue('Planering')
    expect(screen.getByLabelText('Starttid')).toHaveValue('09:00')
    expect(screen.getByLabelText('Sluttid')).toHaveValue('10:00')
    expect(screen.getByRole('textbox', { name: 'Plats' })).toHaveValue('Rum 4')
    expect(screen.getByRole('textbox', { name: 'Beskrivning' })).toHaveValue('Ta med kaffe')
    expect(screen.getByText('Kalender: Jobb')).toBeInTheDocument()
  })

  it('skickar bara det som ändrats', async () => {
    const { onSave, onClose, user } = await renderPanel()
    const title = await screen.findByRole('textbox', { name: 'Titel' })
    await user.clear(title)
    await user.type(title, ' Ny titel ')

    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Ny titel' }, 'this')
    expect(onClose).toHaveBeenCalled()
  })

  it('skickar ingenting när inget ändrats', async () => {
    const { onSave, onClose, user } = await renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Spara' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('sparar med Enter i ett textfält', async () => {
    const { onSave, user } = await renderPanel()
    const location = await screen.findByRole('textbox', { name: 'Plats' })
    await user.clear(location)
    await user.type(location, 'Rum 7{Enter}')

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ location: 'Rum 7' }, 'this')
  })

  it('tömmer plats och beskrivning med tom text', async () => {
    const { onSave, user } = await renderPanel()
    await user.clear(await screen.findByRole('textbox', { name: 'Plats' }))
    await user.clear(screen.getByRole('textbox', { name: 'Beskrivning' }))

    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ location: '', description: '' }, 'this')
  })

  it('ändrar tiden och behåller längden när starten flyttas', async () => {
    const { onSave, user } = await renderPanel()
    const start = await screen.findByLabelText('Starttid')
    await user.clear(start)
    await user.type(start, '13:30')

    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      {
        time: {
          start: '2026-10-21T13:30:00+02:00',
          end: '2026-10-21T14:30:00+02:00',
          allDay: false,
        },
      },
      'this',
    )
  })

  it('gör en händelse till heldag', async () => {
    const { onSave, user } = await renderPanel()

    await user.click(await screen.findByRole('checkbox', { name: 'Heldag' }))
    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      {
        time: { start: '2026-10-21', end: '2026-10-22', allDay: true },
      },
      'this',
    )
  })

  it('spärrar sparande när slutet ligger före början', async () => {
    const { onSave, user } = await renderPanel()
    const end = await screen.findByLabelText('Sluttid')
    await user.clear(end)
    await user.type(end, '08:00')

    expect(screen.getByRole('alert')).toHaveTextContent('Kontrollera datum och tider')
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('byter från kalenderns standard till egna påminnelser', async () => {
    const { onSave, user } = await renderPanel()
    expect(await screen.findByText('30 minuter före · Avisering')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Använd kalenderns standard' }))
    await user.selectOptions(screen.getByLabelText('Tid före start, påminnelse 1'), '60')
    await user.selectOptions(screen.getByLabelText('Metod, påminnelse 1'), 'email')
    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      {
        reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] },
      },
      'this',
    )
  })

  it('lägger till och tar bort påminnelser', async () => {
    const { onSave, user } = await renderPanel({
      event: {
        ...EVENT,
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Lägg till påminnelse' }))
    expect(screen.getByLabelText('Tid före start, påminnelse 2')).toHaveValue('10')
    await user.click(screen.getByRole('button', { name: 'Ta bort påminnelse 1' }))
    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      {
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      },
      'this',
    )
  })

  it('visar en egen tid som inte finns bland valen', async () => {
    await renderPanel({
      event: {
        ...EVENT,
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 45 }] },
      },
    })

    expect(await screen.findByLabelText('Tid före start, påminnelse 1')).toHaveValue('45')
    expect(screen.getByRole('option', { name: '45 minuter före' })).toBeInTheDocument()
  })

  it('går att gå tillbaka till standard utan att något sparas om det var standard från början', async () => {
    const { onSave, user } = await renderPanel()
    const toggle = await screen.findByRole('checkbox', { name: 'Använd kalenderns standard' })

    await user.click(toggle)
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Spara' }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('stängs med Avbryt och Esc utan att spara', async () => {
    const { onSave, onClose, user } = await renderPanel()
    await user.type(await screen.findByRole('textbox', { name: 'Titel' }), 'x')

    await user.click(screen.getByRole('button', { name: 'Avbryt' }))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('tar bort och duplicerar med egna knappar, och stänger panelen', async () => {
    const onDelete = vi.fn()
    const onDuplicate = vi.fn()
    const { onSave, onClose, user } = await renderPanel({ onDelete, onDuplicate })
    await user.type(await screen.findByRole('textbox', { name: 'Titel' }), 'x')

    await user.click(screen.getByRole('button', { name: 'Duplicera' }))
    await user.click(screen.getByRole('button', { name: 'Ta bort' }))

    expect(onDuplicate).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('this')
    expect(onClose).toHaveBeenCalledTimes(2)
    // Det som skrivits men inte sparats följer inte med.
    expect(onSave).not.toHaveBeenCalled()
  })

  it('visar inga knappar för att ta bort eller duplicera utan handlers', async () => {
    await renderPanel()

    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Duplicera' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ta bort' })).not.toBeInTheDocument()
  })

  describe('förekomst av en återkommande händelse', () => {
    const INSTANCE: CalEvent = { ...EVENT, id: 'm1_20261021', recurringEventId: 'm1' }

    it('frågar vad ändringen gäller innan den sparas, och skickar svaret med', async () => {
      const { onSave, onClose, user } = await renderPanel({ event: INSTANCE })
      await user.type(await screen.findByRole('textbox', { name: 'Titel' }), '!')

      await user.click(screen.getByRole('button', { name: 'Spara' }))

      expect(onSave).not.toHaveBeenCalled()
      const dialog = await screen.findByRole('dialog', { name: 'Ändra återkommande händelse' })
      expect(within(dialog).getByRole('radio', { name: 'Bara den här händelsen' })).toBeChecked()
      await user.click(
        within(dialog).getByRole('radio', { name: 'Den här och följande händelser' }),
      )
      await user.click(within(dialog).getByRole('button', { name: 'OK' }))

      expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: 'Planering!' }, 'following')
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('behåller panelen och det som skrivits när man avbryter frågan', async () => {
      const { onSave, onClose, user } = await renderPanel({ event: INSTANCE })
      await user.type(await screen.findByRole('textbox', { name: 'Titel' }), '!')
      await user.click(screen.getByRole('button', { name: 'Spara' }))

      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'Ändra återkommande händelse' }),
        ).getByRole('button', { name: 'Avbryt' }),
      )

      expect(onSave).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveValue('Planering!')
    })

    it('stänger bara frågan med Esc, inte panelen', async () => {
      const { onClose, user } = await renderPanel({ event: INSTANCE })
      await user.type(await screen.findByRole('textbox', { name: 'Titel' }), '!')
      await user.click(screen.getByRole('button', { name: 'Spara' }))
      await screen.findByRole('dialog', { name: 'Ändra återkommande händelse' })

      await user.keyboard('{Escape}')

      expect(onClose).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog', { name: 'Ändra återkommande händelse' })).toBeNull()
      expect(screen.getByRole('dialog', { name: 'Redigera händelse' })).toBeVisible()
    })

    it('frågar vad borttagningen gäller', async () => {
      const onDelete = vi.fn()
      const { onClose, user } = await renderPanel({ event: INSTANCE, onDelete })

      await user.click(await screen.findByRole('button', { name: 'Ta bort' }))
      expect(onDelete).not.toHaveBeenCalled()
      const dialog = await screen.findByRole('dialog', { name: 'Ta bort återkommande händelse' })
      await user.click(within(dialog).getByRole('radio', { name: 'Alla händelser' }))
      await user.click(within(dialog).getByRole('button', { name: 'OK' }))

      expect(onDelete).toHaveBeenCalledExactlyOnceWith('all')
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('frågar inte när inget ändrats, och inte för vanliga händelser', async () => {
      const { onSave, onClose, user } = await renderPanel({ event: INSTANCE })
      await user.click(await screen.findByRole('button', { name: 'Spara' }))

      expect(onSave).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledOnce()
      expect(screen.queryByRole('dialog', { name: 'Ändra återkommande händelse' })).toBeNull()
    })
  })

  it('är låst och utan spara-knapp när kalendern är skrivskyddad', async () => {
    await renderPanel({ readOnlyReason: 'calendar' })

    expect(await screen.findByRole('dialog', { name: 'Händelse' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('läsrätt')
    expect(screen.getByRole('textbox', { name: 'Titel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stäng' })).toBeEnabled()
  })

  it('påverkas inte av att händelsen uppdateras medan panelen är öppen', async () => {
    const i18n = await createI18n('sv')
    const onSave = vi.fn()
    const user = userEvent.setup()
    const ui = (event: CalEvent) => (
      <I18nextProvider i18n={i18n}>
        <EventEditPanel
          event={event}
          calendar={CALENDAR}
          timeZone={TZ}
          onSave={onSave}
          onClose={vi.fn()}
        />
      </I18nextProvider>
    )
    const { rerender } = render(ui(EVENT))
    await user.type(await screen.findByRole('textbox', { name: 'Titel' }), '!')

    rerender(ui({ ...EVENT, title: 'Ändrad av någon annan', etag: '"2"' }))

    expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveValue('Planering!')
  })
})
