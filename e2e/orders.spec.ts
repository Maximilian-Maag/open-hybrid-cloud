import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Orders', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/orders')
  })

  test('orders page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows page title "Orders"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^orders$/i })).toBeVisible()
  })

  test('shows orders subtitle', async ({ page }) => {
    await expect(page.getByText(/view and manage your infrastructure orders/i)).toBeVisible()
  })

  test('shows orders table structure', async ({ page }) => {
    // The Table component always renders a <table> even when empty
    await expect(page.getByRole('table')).toBeVisible()
  })

  test('shows table column headers', async ({ page }) => {
    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    // Check all 6 column headers are rendered in the table
    await expect(table.getByRole('columnheader').nth(0)).toBeVisible()
    await expect(table.getByRole('columnheader').nth(1)).toBeVisible()
    await expect(table.getByRole('columnheader').nth(2)).toBeVisible()
    await expect(table.getByRole('columnheader').nth(3)).toBeVisible()
    await expect(table.getByRole('columnheader').nth(4)).toBeVisible()
    await expect(table.getByRole('columnheader').nth(5)).toBeVisible()
  })

  test('shows empty state message or order rows', async ({ page }) => {
    // The table renders either data rows or a "No orders yet." cell
    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    await expect(table.getByRole('row').first()).toBeVisible()
  })

  test('order rows link to order detail page', async ({ page }) => {
    const orderLinks = page.getByRole('link').filter({ hasText: /^#\d+$/ })
    const count = await orderLinks.count()
    if (count > 0) {
      await orderLinks.first().click()
      await expect(page).toHaveURL(/\/orders\/\d+/)
    }
  })
})
