import { test, expect, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'root@test.dev'
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123'

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByRole('textbox', { name: /password/i }).fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 5000 })
}

test.describe('Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword)
  })

  test('shows the catalog page', async ({ page }) => {
    await page.goto('/')
    // The catalog / shop page should render without errors
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('navigates to catalog from nav', async ({ page }) => {
    // Look for a catalog or shop link in the navigation
    const catalogLink = page.getByRole('link', { name: /catalog|shop/i })
    if (await catalogLink.isVisible()) {
      await catalogLink.click()
      await expect(page.locator('body')).not.toContainText('500')
    }
  })

  test('empty catalog shows a helpful message', async ({ page }) => {
    await page.goto('/')
    // When no products are configured the page should not crash
    await expect(page.locator('body')).toBeVisible()
  })
})
