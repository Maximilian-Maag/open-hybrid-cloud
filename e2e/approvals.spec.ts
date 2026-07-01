import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Approvals', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/approvals')
  })

  test('approvals page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows page title "Approvals"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^approvals$/i })).toBeVisible()
  })

  test('shows pending orders count in subtitle', async ({ page }) => {
    await expect(page.getByText(/orders pending approval/i)).toBeVisible()
  })

  test('shows empty state or pending order cards', async ({ page }) => {
    const noPending = page.getByText(/no pending orders/i)
    const approveBtn = page.getByRole('button', { name: /^approve$/i }).first()
    await expect(noPending.or(approveBtn)).toBeVisible()
  })

  test('pending orders show Approve and Reject buttons', async ({ page }) => {
    const approveBtn = page.getByRole('button', { name: /^approve$/i }).first()
    if (await approveBtn.isVisible()) {
      await expect(page.getByRole('button', { name: /^reject$/i }).first()).toBeVisible()
    }
  })

  test('clicking Reject shows rejection note form', async ({ page }) => {
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first()
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click()
      await expect(page.getByLabel(/rejection note/i)).toBeVisible()
      await expect(page.getByPlaceholder(/explain why/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /confirm rejection/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
    }
  })

  test('cancel on rejection form hides the form', async ({ page }) => {
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first()
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click()
      await expect(page.getByRole('button', { name: /confirm rejection/i })).toBeVisible()
      await page.getByRole('button', { name: /cancel/i }).click()
      await expect(page.getByRole('button', { name: /^approve$/i }).first()).toBeVisible()
    }
  })

  test('approving a pending order removes it from the list', async ({ page }) => {
    const approveBtn = page.getByRole('button', { name: /^approve$/i }).first()
    if (!await approveBtn.isVisible()) { test.skip(); return }

    // Count pending orders before approval
    const beforeCount = await page.getByRole('button', { name: /^approve$/i }).count()
    await approveBtn.click()

    // After approval the order card should disappear (count decreases or empty state appears)
    await page.waitForTimeout(1000)
    const afterCount = await page.getByRole('button', { name: /^approve$/i }).count()
    const noOrders = page.getByText(/no pending orders/i)
    expect(afterCount < beforeCount || await noOrders.isVisible()).toBe(true)
  })

  test('rejecting a pending order with a note removes it from the list', async ({ page }) => {
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first()
    if (!await rejectBtn.isVisible()) { test.skip(); return }

    const beforeCount = await page.getByRole('button', { name: /^reject$/i }).count()
    await rejectBtn.click()
    await page.getByLabel(/rejection note/i).fill('Rejected by e2e test')
    await page.getByRole('button', { name: /confirm rejection/i }).click()

    await page.waitForTimeout(1000)
    const afterCount = await page.getByRole('button', { name: /^reject$/i }).count()
    const noOrders = page.getByText(/no pending orders/i)
    expect(afterCount < beforeCount || await noOrders.isVisible()).toBe(true)
  })
})
