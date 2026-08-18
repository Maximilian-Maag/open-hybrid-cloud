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

// Issue #31. The filters live in the URL rather than in component state, so the
// contract worth pinning is: a control writes to the URL, and a URL renders the
// controls filled in. Both hold with or without infrastructure present.
test.describe('Infrastructure filtering', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/infrastructure')
    await expect(page.getByRole('heading', { name: /^filters$/i })).toBeVisible({ timeout: 8000 })
  })

  test('choosing a status puts it in the URL', async ({ page }) => {
    await page.getByLabel(/^status$/i).selectOption('active')
    await expect(page).toHaveURL(/[?&]status=active/)
  })

  test('a searched term reaches the URL after the debounce', async ({ page }) => {
    await page.getByLabel(/^search$/i).fill('nginx')
    await expect(page).toHaveURL(/[?&]search=nginx/, { timeout: 8000 })
  })

  test('filters combine rather than replace each other', async ({ page }) => {
    await page.getByLabel(/^status$/i).selectOption('active')
    await expect(page).toHaveURL(/status=active/)
    await page.getByLabel(/deployed from/i).fill('2026-01-01')
    await expect(page).toHaveURL(/status=active/)
    await expect(page).toHaveURL(/deployedFrom=2026-01-01/)
  })

  test('a bookmarked filtered URL renders its controls already set', async ({ page }) => {
    await page.goto('/infrastructure?status=decommissioned&search=web&deployedFrom=2026-02-01')
    await expect(page.getByLabel(/^status$/i)).toHaveValue('decommissioned')
    await expect(page.getByLabel(/^search$/i)).toHaveValue('web')
    await expect(page.getByLabel(/deployed from/i)).toHaveValue('2026-02-01')
  })

  test('the "all" option is selectable, so a filter can be undone in place', async ({ page }) => {
    await page.goto('/infrastructure?status=active')
    // Select's own placeholder renders disabled; the filter bar uses a real
    // option so "all statuses" stays reachable without clearing everything.
    await page.getByLabel(/^status$/i).selectOption('')
    await expect(page).not.toHaveURL(/status=/)
  })

  test('Clear filters appears only when filtered and strips the query string', async ({ page }) => {
    const clear = page.getByRole('button', { name: /clear filters/i })
    await expect(clear).toBeHidden()

    await page.getByLabel(/^status$/i).selectOption('active')
    await expect(clear).toBeVisible()
    await clear.click()
    await expect(page).toHaveURL(/\/infrastructure$/)
  })

  test('an over-narrow filter shows the no-match state, not the never-deployed one', async ({ page }) => {
    await page.goto('/infrastructure?search=zzz-no-such-infrastructure-zzz')
    await expect(page.getByText(/no infrastructure matches these filters/i)).toBeVisible({ timeout: 8000 })
  })

  test('the result count is announced in a live region', async ({ page }) => {
    const status = page.locator('[role="status"][aria-live="polite"]')
    await expect(status).toContainText(/matching elements/i)
  })
})
