import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '@/i18n'
import { ErrorBoundary } from './ErrorBoundary'

function Broken(): never {
  throw new Error('kraschade')
}

async function renderWith(children: React.ReactNode, onError = vi.fn()) {
  const i18n = await createI18n('sv')
  render(
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary onError={onError}>{children}</ErrorBoundary>
    </I18nextProvider>,
  )
  return onError
}

describe('ErrorBoundary', () => {
  it('visar innehållet när inget går fel', async () => {
    await renderWith(<p>allt väl</p>)

    expect(screen.getByText('allt väl')).toBeInTheDocument()
    expect(screen.queryByTestId('crash-screen')).not.toBeInTheDocument()
  })

  it('visar ett begripligt besked med "Ladda om" och rapporterar felet när något kraschar', async () => {
    // React loggar fel som fångas av en boundary. Tysta det i testet.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const onError = await renderWith(<Broken />)

    expect(await screen.findByTestId('crash-screen')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Något gick fel')
    expect(screen.getByRole('button', { name: 'Ladda om' })).toBeInTheDocument()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'kraschade' })
  })
})
