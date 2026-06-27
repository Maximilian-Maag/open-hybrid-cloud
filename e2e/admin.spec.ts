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

test.describe('Admin area', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword)
  })

  test('admin panel is accessible to root user', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('Forbidden')
  })

  test('user management page loads', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('categories page loads', async ({ page }) => {
    await page.goto('/admin/categories')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('products page loads', async ({ page }) => {
    await page.goto('/admin/products')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('environments page loads', async ({ page }) => {
    await page.goto('/admin/environments')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('approvals page loads', async ({ page }) => {
    await page.goto('/admin/approvals')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('unauthenticated user is redirected away from admin', async ({ page }) => {
    // Navigate in a fresh context without logging in
    await page.context().clearCookies()
    await page.goto('/admin')
    // Should redirect to login or show unauthorized
    const url = page.url()
    const body = await page.locator('body').textContent()
    const isProtected =
      url.includes('/login') ||
      (body ?? '').toLowerCase().includes('unauthorized') ||
      (body ?? '').toLowerCase().includes('sign in')
    expect(isProtected).toBe(true)
  })
})
