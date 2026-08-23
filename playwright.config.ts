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
  //      products, categories, users) against one shared database and then
  //      assert on list contents — e.g. admin-environments deletes "the last
  //      row with a Delete button", and auth.spec logs out and back in as root
  //      while every other test shares the same storageState. Concurrency
  //      makes those interfere by construction, no matter how much CPU there is.
  // Raising this needs BOTH fixed first: serve production builds instead of
  // `next dev`, and isolate per-worker state (or mark the admin specs serial).
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
      // The reflow gate is the mobile project's job. Running it here too would
      // measure 1280x720 — the one width at which the bug it exists for does not
      // reproduce — and report a pass for it.
      testIgnore: /reflow\.spec\.ts/,
      dependencies: ['setup'],
    },
    // The suite ran at exactly one viewport until #169, which is how a 349px
    // horizontal overflow on every authenticated page reached users (#167):
    // `devices[` appeared exactly once in the whole repo, on the line above.
    //
    // A real device descriptor rather than `viewport: { width: 375, … }`: it also
    // brings the mobile user agent, hasTouch and deviceScaleFactor, so a layout
    // that only holds together with a hover-capable pointer fails here. Pixel 7 is
    // 412x915; reflow.spec.ts resizes down to 320 (the WCAG 1.4.10 number) itself.
    //
    // Only reflow.spec.ts runs here. The rest of the suite asserts behaviour, not
    // layout, and running all of it twice would double a serial CI run to buy
    // nothing.
    {
      name: 'mobile',
      testMatch: /reflow\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
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
