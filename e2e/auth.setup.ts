import { test as setup } from '@playwright/test'
import path from 'path'
import { rootEmail, rootPassword } from './helpers'

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
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 75_000 })
  await page.context().storageState({ path: rootAuthFile })
})
