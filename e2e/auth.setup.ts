import { test as setup } from '@playwright/test'
import path from 'path'
import { rootEmail, rootPassword } from './helpers'

export const rootAuthFile = path.join(__dirname, '.auth/root.json')

setup('authenticate as root', async ({ page }) => {
  await page.goto('/login')
  // From helpers, which fall back to the account the backend bootstrap actually
  // creates. This file used to carry its own copy of the defaults, so fixing them
  // in helpers.ts alone would have left every authenticated run still failing.
  await page.getByLabel(/email address/i).fill(rootEmail)
  await page.getByLabel(/password/i).fill(rootPassword)
  await page.getByRole('button', { name: /sign in/i }).click()
  // 30s, not 10s: the suite runs against `next dev`, which compiles the login
  // route, the auth handler and the destination page on first request. Measured
  // cold-start logins take 11–15s, so a 10s budget made this setup — and
  // therefore every authenticated test — flaky for a reason that has nothing to
  // do with the app.
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
  await page.context().storageState({ path: rootAuthFile })
})
