import { test, expect } from '@playwright/test'
import { rootEmail, rootPassword } from './helpers'

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('shows the login form', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible()
  })

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.getByRole('textbox', { name: /email/i }).fill('nobody@example.com')
    await page.getByRole('textbox', { name: /password/i }).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    await expect(page.getByText(/invalid email or password|invalid credentials|incorrect|wrong/i)).toBeVisible({ timeout: 5000 })
  })

  test('redirects to dashboard after successful login', async ({ page }) => {
    // Requires the test admin user to exist in the DB (seeded by bootstrap)
    const email = rootEmail
    const password = rootPassword

    await page.getByRole('textbox', { name: /email/i }).fill(email)
    await page.getByRole('textbox', { name: /password/i }).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    // Should navigate away from /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 })
  })

  /**
   * The case that broke CI on #36 and blocked the whole suite.
   *
   * The two-step sign-in put a `POST /api/login-challenge` in front of every
   * login, and the middleware matcher still protected it — so the form's own
   * fetch was 307'd to /login, came back as HTML instead of JSON, and an account
   * with NO second factor was told "Invalid email or password". `auth.setup.ts`
   * failed on it, and with it all 243 authenticated tests.
   *
   * Asserting on the response, not just the destination: a login that lands on
   * the dashboard for some other reason would not tell us the challenge hop
   * still answers as itself.
   */
  test('an account with no second factor signs in in one step', async ({ page, context }) => {
    // A genuinely signed-out browser — this project carries the shared root
    // storageState, and the middleware only redirects the unauthenticated.
    await context.clearCookies()
    await page.goto('/login')

    const challenge = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/login-challenge' && r.request().method() === 'POST',
    )

    await page.getByRole('textbox', { name: /email/i }).fill(rootEmail)
    await page.getByRole('textbox', { name: /password/i }).fill(rootPassword)
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    const res = await challenge
    // A 307 here is the regression: the middleware swallowing the hop.
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, mfaRequired: false })

    // One step: no code is ever asked for.
    await expect(page.getByLabel(/authentication code/i)).toHaveCount(0)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('keeps the user on the login page after failed attempt', async ({ page }) => {
    await page.getByRole('textbox', { name: /email/i }).fill('bad@example.com')
    await page.getByRole('textbox', { name: /password/i }).fill('bad')
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/\/login/)
  })
})
