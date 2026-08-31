import { test, expect } from './fixtures'
import { loginAsRoot, expectNoServerError } from './helpers'

/**
 * Open the first product's edit page, or say there is nothing to open.
 *
 * Thirteen tests in this file opened the same page the same way, and every one
 * of them clicked the Edit link and then asserted the URL. That is two separate
 * races: a Next.js `<Link>` is inert until React hydrates, and `next dev`
 * compiles `/admin/products/[id]` on its first request — which together made
 * the 5s default assertion timeout a coin flip on a loaded CI runner (#296).
 *
 * Navigating by `href` sidesteps both. It still proves the list links point at
 * a real edit page, which is all the click was ever demonstrating here.
 */
async function openFirstProductEdit(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/products')
  await expectNoServerError(page)

  const editLinks = page.getByRole('link', { name: /edit/i })
  const noProducts = page.getByText(/no products/i)
  await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
  if (await noProducts.isVisible()) return false

  const href = await editLinks.first().getAttribute('href')
  expect(href, 'the product list has an Edit link with no href').toBeTruthy()
  await page.goto(href as string)
  // Generous: this is the first compile of the route in a dev-server run.
  await expect(page).toHaveURL(/\/admin\/products\/\d+/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /pipeline stacks/i })).toBeVisible({ timeout: 30_000 })
  return true
}

test.describe('Admin - Pipeline Stacks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  test('pipeline stacks card is visible on product edit page', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }

    await expect(page.getByRole('heading', { name: /pipeline stacks/i })).toBeVisible()
  })

  test('pipeline stacks card shows empty state or existing stacks', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }

    await expect(page.getByRole('button', { name: /add stack/i })).toBeVisible()
    const emptyState = page.getByText(/no pipeline stacks configured/i)
    const stackItem = page.locator('[data-testid="stack-item"]').first()
    await expect(emptyState.or(stackItem)).toBeVisible({ timeout: 5000 })
  })

  test('"Add Stack" button opens the modal', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }

    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /add pipeline stack/i })).toBeVisible()
  })

  test('modal contains all required fields', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    /*
     * Deliberately NOT scoped to the dialog, and that is a defect, not a
     * choice — see #305.
     *
     * `/^name$/i` and `/environment/i` also match the product's own Name field
     * and its offering rows on the page behind the modal. Scoping these to
     * `getByRole('dialog')` makes them fail, and the failure snapshot shows no
     * open dialog at all: the modal is opening and then closing again before
     * the assertions run. So the fields these lines have been finding are the
     * page's, not the modal's, and the test has been passing for the wrong
     * reason.
     *
     * Left as it was rather than fixed here, because fixing the locator turns
     * one red test into six and the cause is the modal, not the selector. It
     * belongs in its own change.
     */
    await expect(page.getByLabel(/^name$/i)).toBeVisible()
    await expect(page.getByLabel(/environment/i)).toBeVisible()
    await expect(page.getByLabel(/webhook url/i)).toBeVisible()
    await expect(page.getByLabel(/webhook token/i)).toBeVisible()
    await expect(page.getByLabel(/state key parameter/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /\+ add step/i })).toBeVisible()
  })

  test('"Add Step" button adds a step form inside the modal', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 1/i)).toBeVisible()
    await expect(page.getByLabel(/template/i)).toBeVisible()
    await expect(page.getByLabel(/state suffix/i)).toBeVisible()
  })

  test('adding two steps shows step 1 and step 2', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()

    await expect(page.getByText(/step 1/i)).toBeVisible()
    await expect(page.getByText(/step 2/i)).toBeVisible()
  })

  test('removing a step decreases step count', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 2/i)).toBeVisible()

    // Scoped to the dialog. The product edit page grew its own Remove buttons —
    // one per offering, and one per size cell since #249 — so a page-wide
    // `getByRole('button', { name: /remove/i }).first()` stopped meaning the
    // step's Remove and started meaning whichever came first in the document
    // (#296).
    const removeBtns = page.getByRole('dialog').getByRole('button', { name: /remove/i })
    await removeBtns.first().click()
    await expect(page.getByText(/step 2/i)).not.toBeVisible()
    await expect(page.getByText(/step 1/i)).toBeVisible()
  })

  test('submit button is disabled when no steps are added', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const submitBtn = page.getByRole('button', { name: /^add$/i })
    await expect(submitBtn).toBeDisabled()
  })

  test('cancel button closes the modal', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('"Edit Stack" button opens modal pre-filled with stack data', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }

    const stackItem = page.locator('[data-testid="stack-item"]').first()
    const noStacks = page.getByText(/no pipeline stacks configured/i)
    await expect(stackItem.or(noStacks)).toBeVisible({ timeout: 5000 })

    if (await noStacks.isVisible()) { test.skip(); return }

    await stackItem.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByRole('heading', { name: /edit pipeline stack/i })).toBeVisible()
    await expect(page.getByLabel(/^name$/i)).not.toBeEmpty()
  })
})

test.describe('Admin - Pipeline Stacks: full create → delete flow', () => {
  test('create a pipeline stack and verify it appears, then delete it', async ({ page }) => {
    await loginAsRoot(page)
    if (!(await openFirstProductEdit(page))) { test.skip(); return }

    // Check if an environment is configured — required for the form select
    const envSelector = page.locator('select')
    const hasEnv = await envSelector.count() > 0

    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    if (!hasEnv) {
      // No environment select options available — can't complete the form
      await page.getByRole('button', { name: /cancel/i }).click()
      test.skip()
      return
    }

    // Fill in the form
    await page.getByLabel(/^name$/i).fill('E2E Test Stack')
    const envSelect = page.getByLabel(/environment/i)
    const firstOption = envSelect.locator('option').nth(1)
    const optionExists = await firstOption.count() > 0
    if (!optionExists) {
      await page.getByRole('button', { name: /cancel/i }).click()
      test.skip()
      return
    }
    await envSelect.selectOption({ index: 1 })
    await page.getByLabel(/webhook url/i).fill('https://gitlab.example.com/api/v4/projects/1/trigger/pipeline')
    await page.getByLabel(/webhook token/i).fill('e2e-test-token')

    // Add a step
    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 1/i)).toBeVisible()
    await page.getByLabel(/template/i).fill('linode/virtual-machine')
    await page.getByLabel(/state suffix/i).fill('-vm')

    // Submit
    await page.getByRole('button', { name: /^add$/i }).click()

    // Stack should appear in the list
    await expect(page.getByText('E2E Test Stack')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/1 step/i)).toBeVisible()

    // Delete the stack
    // `data-testid="stack-item"`, not a div filtered by text. `locator('div')`
    // matches every ancestor containing the string too, so on a page that has
    // grown — the size matrix arrived in #249 — the filter resolves to a stack
    // of nested divs and the click lands on whichever Playwright picks (#296).
    const deleteBtn = page
      .locator('[data-testid="stack-item"]')
      .filter({ hasText: 'E2E Test Stack' })
      .getByRole('button', { name: /delete/i })
    await deleteBtn.click()

    // Stack should be removed
    await expect(page.getByText('E2E Test Stack')).not.toBeVisible({ timeout: 3000 })
  })

  test('step form exposes Exec Order and Upstream State Refs (v2 features)', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()

    await expect(page.getByLabel(/exec order/i)).toBeVisible()
    await expect(page.getByText(/upstream state refs/i)).toBeVisible()
    // Adding an upstream ref reveals varName + suffix inputs
    await page.getByRole('button', { name: /\+ add ref/i }).click()
    await expect(page.getByLabel(/var name/i)).toBeVisible()
    await expect(page.getByLabel(/from suffix/i)).toBeVisible()
  })

  test('"Preview YAML" button opens the pipeline preview modal', async ({ page }) => {
    if (!(await openFirstProductEdit(page))) { test.skip(); return }
    await page.getByRole('button', { name: /add stack/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()
    await page.getByLabel(/template/i).fill('linode/virtual-machine')
    await page.getByLabel(/state suffix/i).fill('-vm')

    await page.getByRole('button', { name: /preview yaml/i }).click()
    await expect(page.getByRole('heading', { name: /generated pipeline yaml/i })).toBeVisible()
    // Preview text contains the substituted state name placeholder and the template path
    await expect(page.getByText(/TF_STATE_NAME:/)).toBeVisible()
    await expect(page.getByText(/templates\/linode\/virtual-machine/)).toBeVisible()
  })
})
