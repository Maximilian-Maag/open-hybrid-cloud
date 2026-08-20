import { test as setup } from '@playwright/test'
import path from 'path'

export const rootAuthFile = path.join(__dirname, '.auth/root.json')

setup('authenticate as root', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email address/i).fill(process.env.E2E_ADMIN_EMAIL ?? 'root@local.dev')
  await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD ?? 'root1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  // 30s, not 10s: the suite runs against `next dev`, which compiles the login
  // route, the auth handler and the destination page on first request. Measured
  // cold-start logins take 11–15s, so a 10s budget made this setup — and
  // therefore every authenticated test — flaky for a reason that has nothing to
  // do with the app.
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
  await page.context().storageState({ path: rootAuthFile })
})
