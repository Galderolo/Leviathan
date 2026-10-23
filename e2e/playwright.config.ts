import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (`npm run build`) through Electron. Run them with `npm run e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One app at a time: each test starts its own window and git processes.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: '../test-results/e2e',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' }
})
