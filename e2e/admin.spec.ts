import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin area', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  test('admin panel is accessible to root user', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('Forbidden')
  })

  test('admin dashboard shows page title', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible()
  })

  test('admin dashboard shows all section cards', async ({ page }) => {
    await page.goto('/admin')
    // Links include description text in accessible name, so use partial match (no $ anchor)
    await expect(page.getByRole('link', { name: /^categories/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^products/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^environments/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^users/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^branding/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^cost centers/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^ci sources/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^global parameters/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^smtp config/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^ai config/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^exchange rates/i })).toBeVisible()
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

  test('cost centers page loads', async ({ page }) => {
    await page.goto('/admin/cost-centers')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('branding page loads', async ({ page }) => {
    await page.goto('/admin/branding')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('SMTP config page loads', async ({ page }) => {
    await page.goto('/admin/config/smtp')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('AI config page loads', async ({ page }) => {
    await page.goto('/admin/config/ai')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('exchange rates page loads', async ({ page }) => {
    await page.goto('/admin/exchange-rates')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('CI sources page loads', async ({ page }) => {
    await page.goto('/admin/ci-sources')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('global parameters page loads', async ({ page }) => {
    await page.goto('/admin/parameters')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('approvals page is accessible to root user', async ({ page }) => {
    await page.goto('/approvals')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('audit log page is accessible to root user', async ({ page }) => {
    await page.goto('/audit')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('unauthenticated user is redirected to /login from /admin', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/, { timeout: 6000 })
  })

  test('new product page loads', async ({ page }) => {
    await page.goto('/admin/products/new')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })
})

test.describe('Admin - Internationalization', () => {
  test('language switcher is visible in header', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')
    // Language switcher shows current language code (e.g. "EN")
    await expect(page.getByRole('button', { name: /language/i })).toBeVisible()
  })

  test('switching language updates UI text', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')

    // Open language switcher (aria-label: "Language: English")
    await page.getByRole('button', { name: /language/i }).click()
    // Select German — button contains both code span "DE" and name span "Deutsch"
    await page.locator('button').filter({ has: page.locator('span').filter({ hasText: /^DE$/ }) }).click()

    // After switching, the catalog nav link changes from "Catalog" to "Katalog"
    await expect(page.getByRole('link', { name: 'Katalog', exact: true })).toBeVisible({ timeout: 5000 })

    // Switch back to English
    await page.getByRole('button', { name: /language/i }).click()
    await page.locator('button').filter({ has: page.locator('span').filter({ hasText: /^EN$/ }) }).click()
    await expect(page.getByRole('link', { name: /^catalog$/i })).toBeVisible({ timeout: 5000 })
  })

  test('selected language persists after page reload', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')

    // Switch to German
    await page.getByRole('button', { name: /language/i }).click()
    await page.locator('button').filter({ has: page.locator('span').filter({ hasText: /^DE$/ }) }).click()
    await expect(page.getByRole('link', { name: 'Katalog', exact: true })).toBeVisible({ timeout: 5000 })

    // Reload the page — lang cookie should persist the language
    await page.reload()
    await expect(page.getByRole('link', { name: 'Katalog', exact: true })).toBeVisible({ timeout: 5000 })

    // Switch back to English
    await page.getByRole('button', { name: /language/i }).click()
    await page.locator('button').filter({ has: page.locator('span').filter({ hasText: /^EN$/ }) }).click()
    await expect(page.getByRole('link', { name: /^catalog$/i })).toBeVisible({ timeout: 5000 })
  })
})
