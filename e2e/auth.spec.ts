import { test, expect } from '@playwright/test'
import { loginAs } from './helpers'

const protectedRoutes = [
  '/',
  '/catalog',
  '/orders',
  '/projects',
  '/infrastructure',
  '/settings',
  '/approvals',
  '/audit',
  '/admin',
]

test.describe('Authentication & route protection', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  for (const route of protectedRoutes) {
    test(`unauthenticated access to ${route} redirects to /login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/, { timeout: 6000 })
    })
  }

  test('login page is publicly accessible', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('redirect preserves callbackUrl after login', async ({ page }) => {
    await page.goto('/orders')
    await expect(page).toHaveURL(/\/login\?callbackUrl/, { timeout: 6000 })
  })
})

test.describe('Role-based access control', () => {
  test('non-admin user is redirected away from /admin', async ({ page }) => {
    // Create a project_manager user via API then test access
    // We test this by logging in as root, creating a PM user, logging in as PM, then checking /admin
    const pmEmail = `e2e-pm-${Date.now()}@example.com`
    const pmPassword = 'E2eTest123!'

    // Create PM user via the admin panel (logged in as root)
    await page.goto('/login')
    await page.getByLabel(/email address/i).fill(process.env.E2E_ADMIN_EMAIL ?? 'root@local.dev')
    await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD ?? 'root1234')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 })

    await page.goto('/admin/users')
    await expect(page.getByRole('button', { name: /add user/i })).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /add user/i }).click()
    await page.getByLabel(/^email/i).fill(pmEmail)
    await page.getByLabel(/^name/i).fill('E2E PM User')
    await page.getByLabel(/^password/i).fill(pmPassword)
    await page.getByRole('button', { name: /^create$/i }).click()
    await expect(page.getByText(pmEmail)).toBeVisible({ timeout: 8000 })

    // Log out
    await page.getByText(/my account/i).click()
    await page.getByRole('button', { name: /sign out/i }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 })

    // Log in as PM user
    await loginAs(page, pmEmail, pmPassword)

    // Attempt to access /admin — should be redirected away (not to /admin content)
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/admin$/, { timeout: 6000 })

    // Clean up: log back in as root and delete the PM user
    await page.goto('/login')
    await page.getByLabel(/email address/i).fill(process.env.E2E_ADMIN_EMAIL ?? 'root@local.dev')
    await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD ?? 'root1234')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 })
    await page.goto('/admin/users')
    await expect(page.getByText(pmEmail)).toBeVisible({ timeout: 8000 })
    const userRow = page.locator('div').filter({ has: page.getByText(pmEmail) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).first()
    await userRow.getByRole('button', { name: /^delete$/i }).click()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
  })
})
