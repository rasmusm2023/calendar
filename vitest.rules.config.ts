import { defineConfig } from 'vitest/config'

// Regeltester kör mot Firestore-emulatorn (se `npm run test:rules`), därför en egen konfiguration.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore-tests/**/*.test.ts'],
    testTimeout: 15_000,
    // Alla tester delar en emulator och rensar data mellan testerna.
    fileParallelism: false,
  },
})
