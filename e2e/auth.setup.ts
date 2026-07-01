import { test as setup } from '@playwright/test'
import path from 'path'

export const rootAuthFile = path.join(__dirname, '.auth/root.json')

setup('authenticate as root', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email address/i).fill(process.env.E2E_ADMIN_EMAIL ?? 'root@local.dev')
  await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD ?? 'root1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 })
  await page.context().storageState({ path: rootAuthFile })
})
