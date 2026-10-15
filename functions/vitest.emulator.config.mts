import { defineConfig } from 'vitest/config'

// Körs mot Auth-, Firestore- och Functions-emulatorerna (npm run test:functions:emulator från roten).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['emulator-tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
