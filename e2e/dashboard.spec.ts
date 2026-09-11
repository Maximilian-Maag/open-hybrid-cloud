import { test, expect } from './fixtures'
import { createAccount, loginAsRoot, rootStorageStateFile, signInAsAccount } from './helpers'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')
  })

  test('shows welcome message with username', async ({ page }) => {
    await expect(page.getByText(/welcome back/i)).toBeVisible()
  })

  test('shows hero subtitle and Browse Catalog button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /browse catalog/i })).toBeVisible()
  })

  test('shows stats: Total Orders and Active Infrastructure', async ({ page }) => {
    await expect(page.getByText(/total orders/i)).toBeVisible()
    await expect(page.getByText(/active infrastructure/i)).toBeVisible()
  })

  test('shows Projects stat card', async ({ page }) => {
    // The stat card is a link to /projects that also contains "Manage" — unique among Projects links
    await expect(page.locator('a[href="/projects"]').filter({ hasText: /manage/i })).toBeVisible()
  })

  test('shows top navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: /^home$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^catalog$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^orders$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^projects$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^infrastructure$/i })).toBeVisible()
  })

  test('shows admin-only nav links for root user', async ({ page }) => {
    await expect(page.getByRole('link', { name: /^approvals$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^audit$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^admin$/i })).toBeVisible()
  })

  test('shows search bar in header', async ({ page }) => {
    await expect(page.getByPlaceholder(/search products/i)).toBeVisible()
  })

  test('shows My Account control', async ({ page }) => {
    await expect(page.getByText(/my account/i)).toBeVisible()
  })

  test('navigates to catalog from Browse Catalog button', async ({ page }) => {
    await page.getByRole('link', { name: /browse catalog/i }).click()
    // waitForURL, not toHaveURL: the target route is compiled on first request by
    // `next dev`, which on a cold CI runner takes longer than the 5s default
    // expect timeout. Same assertion, a budget that matches the server.
    await page.waitForURL(/\/catalog/, { timeout: 30_000 })
  })

  test('navigates to orders from top nav', async ({ page }) => {
    await page.getByRole('link', { name: /^orders$/i }).first().click()
    await page.waitForURL(/\/orders/, { timeout: 30_000 })
  })

  test('navigates to projects from top nav', async ({ page }) => {
    await page.getByRole('link', { name: /^projects$/i }).first().click()
    await page.waitForURL(/\/projects/, { timeout: 30_000 })
  })

  test('header search submits and goes to catalog with query', async ({ page }) => {
    await page.getByPlaceholder(/search products/i).fill('server')
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/catalog\?q=server/, { timeout: 30_000 })
  })

})

/*
 * On its OWN session, and that is now load-bearing rather than tidy.
 *
 * `loginAsRoot` has a fast path that returns immediately when the context is
 * already authenticated, which it always is here: the `chromium` project seeds
 * every context from `e2e/.auth/root.json`. So this test used to sign out the
 * session that every other spec in the run is holding.
 *
 * That was harmless while signing out only cleared a cookie — the saved file
 * was untouched and each context had its own copy, which is what the config
 * comment in playwright.config.ts says. #391 ended that: sign-out now REVOKES
 * the session server-side, because a cleared cookie was never proof the
 * session had ended. One shared token, revoked, and everything afterwards
 * renders signed-in from its cookie while every API call is refused — a
 * catalogue that says "No products yet." rather than an error, which is how
 * this surfaced: seventeen failures in a later shard, none of them near the
 * sign-out that caused them.
 *
 * An empty `storageState` makes `loginAsRoot` actually sign in, so the session
 * this ends is its own.
 */
test.describe('Dashboard sign-out', () => {
  // Creating and signing in an account is a round trip or two.
  test.setTimeout(120_000)

  test('sign out returns to login page', async ({ browser }) => {
    // A project manager, not root: root carries a mandatory second factor
    // (#197) and a TOTP code is single-use, so a fresh root sign-in here would
    // contend with the one `auth.spec` already does. This test is about the
    // affordance, which is the same for every role.
    const rootContext = await browser.newContext({ storageState: rootStorageStateFile })
    let account
    try {
      account = await createAccount(await rootContext.newPage(), 'project_manager')
    } finally {
      await rootContext.close()
    }

    const { page, context } = await signInAsAccount(browser, account)
    try {
      await page.goto('/')
      await page.getByText(/my account/i).click()
      await page.getByRole('button', { name: /sign out/i }).click()
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    } finally {
      await context.close()
    }
  })
})
