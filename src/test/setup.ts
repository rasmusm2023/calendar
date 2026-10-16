import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom saknar pekarfångst, som Radix-primitiver (Toast, menyer, m.fl.) använder vid klick.
const pointerCapture = {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
}
if (typeof Element !== 'undefined') {
  for (const [name, value] of Object.entries(pointerCapture)) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true })
    }
  }
}

afterEach(() => {
  cleanup()
})
