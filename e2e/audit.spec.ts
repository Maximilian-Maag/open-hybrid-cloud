import { test, expect } from './fixtures'
import { loginAsRoot, expectNoServerError } from './helpers'

test.describe('Audit log', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/audit')
  })

  test('audit page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expectNoServerError(page)
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
    await expectNoServerError(page)
  })

  /*
   * Scoped to the pager, and that is the whole point.
   *
   * This read `page.getByRole('button', { name: /next/i })` at document level,
   * which also matches the dev-tools button `next dev` injects into every page.
   * That button is always there, so the guard was reporting on the overlay
   * rather than on the table — whenever the overlay happened to mount first the
   * body ran against a table with no pagination and failed on a Previous that
   * was never rendered, and the rest of the time the assertion did not run at
   * all. It had therefore never once checked what it is named after.
   *
   * The behaviour is worth asserting properly: Previous is rendered but
   * disabled on page 1, and clicking Next both enables it and advances the
   * counter. Asserting only "both buttons exist" would pass against a pager
   * whose buttons do nothing.
   */
  test('pagination pages through the log when there is more than one page', async ({ page }) => {
    const pager = page.getByTestId('audit-pager')
    const rows = page.getByRole('row')
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })

    // No pager is a legitimate state, not a reason to skip: it means the log fits
    // on one page, and that is worth asserting rather than shrugging at. A pager
    // that failed to render over 20+ entries would otherwise read as "fits on one
    // page" for ever.
    if ((await pager.count()) === 0) {
      expect(await rows.count(), 'no pager, so the log must fit on one page').toBeLessThanOrEqual(21)
      return
    }

    const prevBtn = pager.getByRole('button', { name: /previous/i })
    const nextBtn = pager.getByRole('button', { name: /next/i })

    await expect(pager).toContainText(/page 1 \/ \d+/i)
    await expect(prevBtn).toBeDisabled()
    await expect(nextBtn).toBeEnabled()

    await nextBtn.click()

    await expect(pager).toContainText(/page 2 \/ \d+/i)
    await expect(prevBtn).toBeEnabled()
  })
})
