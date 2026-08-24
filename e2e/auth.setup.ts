import { test as setup } from '@playwright/test'
import path from 'path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  rootEmail,
  rootPassword,
  totpCode,
  totpSecretFile,
  totpStepOf,
  waitForTotpStepAfter,
  completeSecondFactor,
} from './helpers'

export const rootAuthFile = path.join(__dirname, '.auth/root.json')

// Three times Playwright's 30s default. This one test pays the whole suite's
// cold-start bill: `next dev` compiles /login, /api/login-challenge, the NextAuth
// handler and the dashboard on first request, and the sign-in waits on all four
// in series. A measured cold run on a loaded machine spends ~9s + ~6s + ~6s + ~9s
// and lands at ~32s — over the default, with nothing wrong. The two-step sign-in
// (#36) added the /api/login-challenge compile to that chain; 30s had no room
// left for it.
setup.setTimeout(90_000)

setup('authenticate as root', async ({ page }) => {
  await page.goto('/login')
  // From helpers, which fall back to the account the backend bootstrap actually
  // creates. This file used to carry its own copy of the defaults, so fixing them
  // in helpers.ts alone would have left every authenticated run still failing.
  await page.getByLabel(/email address/i).fill(rootEmail)
  await page.getByLabel(/password/i).fill(rootPassword)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Generous on purpose: the suite runs against `next dev`, which compiles the
  // login route, the challenge route, the auth handler and the destination page
  // on first request. A cold login is measured in tens of seconds, so a tight
  // budget made this setup — and therefore every authenticated test — flaky for
  // a reason that has nothing to do with the app. Kept under the test timeout
  // above so a real failure reports as "still on /login", not "test timed out".
  // Two-step already, if a previous run enrolled the factor and the database
  // survived. On CI the database is a fresh container, so this is a no-op there.
  await completeSecondFactor(page)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 75_000 })

  await enrolSecondFactorIfRequired(page)
  await page.context().storageState({ path: rootAuthFile })
})

/**
 * Enrol the root account's authenticator, if #197 is asking for one.
 *
 * The suite cannot skip this and it should not want to: a second factor is
 * mandatory for administrators now, so an authenticated root session is one that
 * has been through this. Everything else in the suite would otherwise be testing
 * a state no real administrator can be in — signed in and refused every route.
 *
 * Driven through the UI rather than seeded into the database, because the secret
 * is stored as an AES-256-GCM envelope and a fixture that wrote a plaintext one
 * would prove nothing. This is the enrolment a person does, and it doubles as the
 * only end-to-end coverage that path has.
 */
async function enrolSecondFactorIfRequired(page: import('@playwright/test').Page): Promise<void> {
  // The middleware sends an administrator who owes a factor here, and nowhere
  // else. Landing anywhere else means nothing is owed.
  if (!page.url().includes('/settings')) return
  const passwordField = page.getByLabel(/confirm with your password/i)
  if (!(await passwordField.isVisible().catch(() => false))) return

  await passwordField.fill(rootPassword)
  await page.getByRole('button', { name: /set up/i }).click()

  // The setup key, shown once. Whitespace is presentation — the secret is the
  // base32 without it.
  const shown = await page.locator('code').first().innerText()
  const secret = shown.replace(/\s/g, '')
  mkdirSync(path.dirname(totpSecretFile), { recursive: true })
  writeFileSync(totpSecretFile, secret)

  // The step this code belongs to. Confirming spends it — `twoFactor.ts` records
  // the accepted step and refuses anything at or below — so the sign-in below has
  // to wait for a step this account has not used.
  const confirmedAtStep = totpStepOf()
  await page.getByLabel(/authentication code/i).fill(totpCode(secret))
  await page.getByRole('button', { name: /activate/i }).click()

  // The recovery codes appear only on success, so they are what proves the
  // factor is confirmed rather than merely started.
  await page.getByText(/recovery codes/i).first().waitFor({ timeout: 30_000 })

  // Sign in again from scratch rather than waiting for the open session's token
  // to catch up.
  //
  // The card clears the "must enrol" flag through NextAuth's `update()`, and the
  // backend stops refusing the moment `confirm` returns — but the cookie the
  // middleware reads is rewritten asynchronously, and the first version of this
  // raced it and sat on /settings until it timed out. A fresh sign-in mints a
  // token that is simply correct, and it costs a few seconds once per run.
  //
  // It also means the saved storageState comes from the two-step sign-in that is
  // now the real path for an administrator, rather than from a session that
  // happened to predate the requirement.
  await waitForTotpStepAfter(confirmedAtStep)
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel(/email address/i).fill(rootEmail)
  await page.getByLabel(/password/i).fill(rootPassword)
  await page.getByRole('button', { name: /sign in/i }).click()
  await completeSecondFactor(page)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 75_000 })

  // And the gate is lifted: the dashboard is reachable rather than bouncing back
  // to the enrolment screen.
  await page.goto('/')
  await page.waitForURL((url) => !url.pathname.includes('/settings'), { timeout: 30_000 })
}
