import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renderar rotelementet', () => {
    render(<App />)
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
  })
})
