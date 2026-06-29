import { type Page } from '@playwright/test'

export const rootEmail = process.env.E2E_ADMIN_EMAIL ?? 'root@local.dev'
export const rootPassword = process.env.E2E_ADMIN_PASSWORD ?? 'root1234'

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
