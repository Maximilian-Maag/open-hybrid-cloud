import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Kept serial in CI. Two things break when this suite runs concurrently:
  //   1. Both apps are served by `next dev`, which compiles routes on first
  //      request. Ten Chromium workers on a 4-vCPU runner starve it, and plain
  //      `page.goto` calls blow past the 30s test timeout (that is what run
  //      31807504622 failed on — 4 failures + 3 flakes, all navigation
  //      timeouts, no assertion or API errors).
  //   2. The specs mutate GLOBAL singletons (CI sources, environments,
  //      products, categories, users, branding, SMTP and AI config) against one
  //      shared database and then assert on list contents — e.g.
  //      admin-environments deletes "the last row with a Delete button".
  //      Concurrency makes those interfere by construction, no matter how much
  //      CPU there is.
  //
  //      This used to also say "auth.spec logs out and back in as root while
  //      every other test shares the same storageState". That half is not true:
  //      each test gets an independent BrowserContext seeded FROM
  //      e2e/.auth/root.json, and signing out in one context neither rewrites
  //      that file nor invalidates another context's cookie. The real coupling
  //      is the shared database and the branding singleton, and the wrong reason
  //      would have been used to justify the wrong fix (#156).
  // Raising this needs BOTH fixed first: serve production builds instead of
  // `next dev`, and isolate per-worker state (or mark the admin specs serial).
  //
  // CI parallelises on a different axis instead: `ci.yml` runs the suite as four
  // `--shard`s, one job each. A shard is a whole machine with its own Postgres
  // service, its own seed and its own pair of dev servers, so neither objection
  // above applies ACROSS shards — the shared database they describe is not
  // shared between them. That is why the wall clock could come down without
  // this line changing, and why changing it is still the harder job.
  fullyParallel: !process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter frontend dev',
      url: 'http://localhost:3000/api/ping',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
})
