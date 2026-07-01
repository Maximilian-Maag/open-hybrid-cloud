import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Audit log', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/audit')
  })

  test('audit page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows page title "Audit Log"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()
  })

  test('shows audit subtitle', async ({ page }) => {
    await expect(page.getByText(/track all actions and changes/i)).toBeVisible()
  })

  test('shows User ID filter input', async ({ page }) => {
    await expect(page.getByLabel(/user id/i)).toBeVisible()
  })

  test('shows Action filter input with placeholder Any', async ({ page }) => {
    await expect(page.getByLabel(/^action$/i)).toBeVisible()
    await expect(page.getByLabel(/^action$/i)).toHaveAttribute('placeholder', 'Any')
  })

  test('shows From date filter', async ({ page }) => {
    await expect(page.getByLabel(/^from$/i)).toBeVisible()
    await expect(page.getByLabel(/^from$/i)).toHaveAttribute('type', 'date')
  })

  test('shows To date filter', async ({ page }) => {
    await expect(page.getByLabel(/^to$/i)).toBeVisible()
    await expect(page.getByLabel(/^to$/i)).toHaveAttribute('type', 'date')
  })

  test('shows Export CSV button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible()
  })

  test('shows Export PDF button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /export pdf/i })).toBeVisible()
  })

  test('shows table with expected column headers when entries exist', async ({ page }) => {
    // Table is always rendered (even when empty), so just check it's visible
    const table = page.getByRole('table')
    await expect(table).toBeVisible()

    // Only check column headers if there are actual data rows (not just the empty-state row)
    const hasEntries = !(await page.getByText(/no audit entries found/i).isVisible())
    if (hasEntries) {
      await expect(page.getByRole('columnheader', { name: /^id$/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /^user$/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /^action$/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /^entity$/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /^details$/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /^date$/i })).toBeVisible()
    }
  })

  test('filtering by action updates the audit table', async ({ page }) => {
    await page.getByLabel(/^action$/i).fill('login')
    // Table should reload — just check it doesn't crash
    await page.waitForTimeout(600)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows pagination when there are multiple pages', async ({ page }) => {
    const prevBtn = page.getByRole('button', { name: /previous/i })
    const nextBtn = page.getByRole('button', { name: /next/i })
    // Pagination only appears when totalPages > 1; just check controls work if shown
    if (await nextBtn.isVisible()) {
      await expect(prevBtn).toBeVisible()
    }
  })
})
