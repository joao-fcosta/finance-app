import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Os testes SQL sobem um Postgres em WASM (PGlite) por suíte.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
