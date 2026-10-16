import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/features/auth'
import { GoogleAccessGate, GoogleAccessProvider } from '@/features/google-access'
import { createI18n } from '@/i18n'
import { GoogleAccessError } from '@/lib/google'
import { UndoManager, type CommandStep, type UndoCommand } from '@/lib/undo'
import { createFakeAuthService, TEST_USER } from '@/test/fakeAuthService'
import { createFakeGoogleAccessService } from '@/test/fakeGoogleAccessService'
import { useUndo } from './UndoContext'
import { UndoProvider } from './UndoProvider'

function step(apply: () => Promise<void>): CommandStep {
  return { optimistic: () => undefined, apply, rollback: () => undefined }
}

function command(overrides: Partial<UndoCommand> & Pick<UndoCommand, 'forward'>): UndoCommand {
  return {
    label: 'Flytta Gympass',
    key: 'e1',
    backward: step(() => Promise.resolve()),
    ...overrides,
  }
}

function Probe({ cmd }: { cmd: UndoCommand }) {
  const { execute, undo, snapshot } = useUndo()
  return (
    <div>
      <button onClick={() => void execute(cmd)}>kör</button>
      <button onClick={() => void undo()}>ångra</button>
      <p data-testid="can-undo">{String(snapshot.canUndo)}</p>
    </div>
  )
}

async function renderProbe(cmd: UndoCommand) {
  const auth = createFakeAuthService(TEST_USER)
  const google = createFakeGoogleAccessService('connected')
  const i18n = await createI18n('sv')
  const manager = new UndoManager()
  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={auth.service}>
        <GoogleAccessProvider service={google.service}>
          <UndoProvider manager={manager}>
            <GoogleAccessGate>
              <Probe cmd={cmd} />
            </GoogleAccessGate>
          </UndoProvider>
        </GoogleAccessProvider>
      </AuthProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await screen.findByRole('button', { name: 'kör' })
  return { auth, user, manager }
}

describe('UndoProvider', () => {
  it('visar en toast med "Försök igen" när ändringen misslyckas, och försöker igen', async () => {
    let calls = 0
    const { user } = await renderProbe(
      command({
        forward: step(() => {
          calls += 1
          return calls === 1 ? Promise.reject(new Error('nej')) : Promise.resolve()
        }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'kör' }))

    expect(
      await screen.findByText('Kunde inte spara: Flytta Gympass. Ändringen har rullats tillbaka.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('can-undo')).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Försök igen' }))

    await waitFor(() => {
      expect(screen.getByTestId('can-undo')).toHaveTextContent('true')
    })
    expect(calls).toBe(2)
  })

  it('erbjuder "Ångra" i en toast för ändringar med announce', async () => {
    let undone = false
    const { user } = await renderProbe(
      command({
        announce: true,
        label: 'Ta bort Gympass',
        forward: step(() => Promise.resolve()),
        backward: step(() => {
          undone = true
          return Promise.resolve()
        }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'kör' }))
    expect(await screen.findByText('Ta bort Gympass')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Ångra', hidden: false }))

    expect(await screen.findByText('Ångrade: Ta bort Gympass')).toBeInTheDocument()
    expect(undone).toBe(true)
  })

  it('visar ingen toast för lyckade ändringar utan announce', async () => {
    const { user } = await renderProbe(command({ forward: step(() => Promise.resolve()) }))

    await user.click(screen.getByRole('button', { name: 'kör' }))
    await waitFor(() => {
      expect(screen.getByTestId('can-undo')).toHaveTextContent('true')
    })

    expect(screen.queryByText(/Kunde inte|Ångrade/)).not.toBeInTheDocument()
  })

  it('skickar användaren till "Koppla om" när ändringen misslyckas på grund av återkallad åtkomst', async () => {
    const { user } = await renderProbe(
      command({ forward: step(() => Promise.reject(new GoogleAccessError('access_revoked'))) }),
    )

    await user.click(screen.getByRole('button', { name: 'kör' }))

    expect(await screen.findByRole('button', { name: 'Koppla om' })).toBeInTheDocument()
  })

  it('tömmer ångra-stapeln när användaren loggar ut', async () => {
    const { user, auth, manager } = await renderProbe(
      command({ forward: step(() => Promise.resolve()) }),
    )
    await user.click(screen.getByRole('button', { name: 'kör' }))
    await waitFor(() => {
      expect(manager.getSnapshot().canUndo).toBe(true)
    })

    auth.emit(null)

    await waitFor(() => {
      expect(manager.getSnapshot().canUndo).toBe(false)
    })
  })
})
