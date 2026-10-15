import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { createI18n } from '@/i18n'
import { App } from './App'

describe('App', () => {
  it('renderar rotelementet med översatt etikett', async () => {
    const i18n = await createI18n('sv')
    render(
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>,
    )
    expect(screen.getByTestId('app-root')).toHaveAccessibleName('Spaces Calendar')
  })
})
