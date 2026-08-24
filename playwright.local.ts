// Scratch config for a local run against this worktree's own ports (3010/3011).
// NOT committed — the repo's playwright.config.ts pins 3000/3001, and another
// agent's dev server is on 3000 on this machine.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3010',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/root.json' },
      dependencies: ['setup'],
    },
  ],
})
