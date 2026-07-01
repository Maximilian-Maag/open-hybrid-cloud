import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Login once and save session — runs before authenticated tests
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // Authenticated tests reuse the saved root session
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/root.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter backend dev',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter frontend dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
