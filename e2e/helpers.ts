import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

/**
 * Read a value from the backend's .env.
 *
 * The account these tests sign in as is the one the backend bootstrap creates
 * from ADMIN_EMAIL / ADMIN_PASSWORD, and those live in apps/backend/.env — which
 * Playwright does not load. Hardcoded defaults here used to be `root@local.dev`,
 * an account nothing ever creates, so a local run failed at auth.setup with an
 * opaque CredentialsSignin. CI is unaffected either way: it sets E2E_ADMIN_* and
 * ADMIN_* to the same values explicitly.
 *
 * Same hand-rolled parse as e2e/global-setup.ts, and for the same reason: no
 * dotenv dependency in the Playwright process.
 */
const fromBackendEnv = (key: string): string | undefined => {
  try {
    const content = readFileSync('./apps/backend/.env', 'utf-8')
    return content.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

export const rootEmail =
  process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? fromBackendEnv('ADMIN_EMAIL') ?? 'admin@example.com'
export const rootPassword =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? fromBackendEnv('ADMIN_PASSWORD') ?? 'changeme'

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/email address/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 })
}

export async function loginAsRoot(page: Page): Promise<void> {
  // Fast path: skip re-login when already authenticated (e.g. via storageState)
  await page.goto('/')
  if (!page.url().includes('/login')) return
  await page.getByLabel(/email address/i).fill(rootEmail)
  await page.getByLabel(/password/i).fill(rootPassword)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 })
}

/**
 * Assert the page is not a server error, without the false positives.
 *
 * Every spec used to assert `expect(page.locator('body')).not.toContainText('500')`,
 * which reads as "no server error" and means "the digits 500 appear nowhere on the
 * page". It failed a green build the first time a fixture was named with a
 * timestamp ending in 500 (`E2E Env CB 1787319807500`), and it would equally fail
 * on a price, a port, a disk size or a product called "500GB SSD".
 *
 * What actually distinguishes an error page: Next.js renders its own shell with no
 * <main> landmark and one of a small set of headings. So assert the application
 * frame rendered, and that the error text is absent — neither of which any amount
 * of ordinary content can trip.
 */
export async function expectNoServerError(page: Page): Promise<void> {
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Internal Server Error')
  await expect(page.locator('body')).not.toContainText('Application error')
  await expect(page.locator('body')).not.toContainText('This page could not be found')
}
