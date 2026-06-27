import { test, expect } from '@playwright/test'

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('shows the login form', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible()
  })

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.getByRole('textbox', { name: /email/i }).fill('nobody@example.com')
    await page.getByRole('textbox', { name: /password/i }).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    await expect(page.getByText(/invalid credentials|incorrect|wrong/i)).toBeVisible({ timeout: 5000 })
  })

  test('redirects to dashboard after successful login', async ({ page }) => {
    // Requires the test admin user to exist in the DB (seeded by bootstrap)
    const email = process.env.E2E_ADMIN_EMAIL ?? 'root@test.dev'
    const password = process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123'

    await page.getByRole('textbox', { name: /email/i }).fill(email)
    await page.getByRole('textbox', { name: /password/i }).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    // Should navigate away from /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 })
  })

  test('keeps the user on the login page after failed attempt', async ({ page }) => {
    await page.getByRole('textbox', { name: /email/i }).fill('bad@example.com')
    await page.getByRole('textbox', { name: /password/i }).fill('bad')
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/\/login/)
  })
})
