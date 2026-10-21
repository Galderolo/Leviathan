import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Setups that create repositories and remotes run many git processes; under a full parallel run they need the same budget.
    hookTimeout: 30000
  }
})
