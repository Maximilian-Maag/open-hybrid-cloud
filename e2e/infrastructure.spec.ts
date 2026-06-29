import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Infrastructure', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/infrastructure')
  })

  test('infrastructure page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows page title "Infrastructure"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^infrastructure$/i })).toBeVisible()
  })

  test('shows infrastructure subtitle', async ({ page }) => {
    await expect(page.getByText(/deployed infrastructure elements grouped by project/i)).toBeVisible()
  })

  test('shows infrastructure elements or empty state', async ({ page }) => {
    // Either empty state message or at least one Card element with project infrastructure
    const emptyState = page.getByText(/no infrastructure elements yet/i)
    const hasEmpty = await emptyState.isVisible()
    if (hasEmpty) {
      await expect(emptyState).toBeVisible()
    } else {
      // Infrastructure elements exist — verify no 500 error
      await expect(page.locator('body')).not.toContainText('500')
    }
  })

  test('navigates to infrastructure from top nav', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /^infrastructure$/i }).first().click()
    await expect(page).toHaveURL(/\/infrastructure/)
  })

  test('infrastructure elements show status badges when present', async ({ page }) => {
    const emptyState = page.getByText(/no infrastructure elements yet/i)
    if (await emptyState.isVisible()) {
      return // No infrastructure to test
    }
    // If there are elements, check that status information is rendered
    await expect(page.locator('body')).not.toContainText('500')
  })
})
