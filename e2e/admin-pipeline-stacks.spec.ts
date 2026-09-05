import { test, expect } from './fixtures'
import { appears, expectNoServerError, loginAsRoot, requireSeeded, requireStack } from './helpers'

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
/** The one offering `seedDemoData` gives a pipeline stack, when DEMO_CI_URL is set. */
const STACKED_PRODUCT = 'Managed Nginx Gateway'

/**
 * Open the edit page of a product named `name`, rather than of whichever one
 * sorts first. Returns false when the catalogue has no such product.
 */
async function openProductEditByName(
  page: import('@playwright/test').Page,
  name: string,
): Promise<boolean> {
  await page.goto('/admin/products')
  await expectNoServerError(page)

  const row = page.getByRole('row').filter({ hasText: name })
  if (!(await appears(row))) return false

  const href = await row.getByRole('link', { name: /edit/i }).first().getAttribute('href')
  expect(href, `the row for ${name} has an Edit link with no href`).toBeTruthy()
  await page.goto(href as string)
  await expect(page).toHaveURL(/\/admin\/products\/\d+/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /pipeline stacks/i })).toBeVisible({ timeout: 30_000 })
  return true
}

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
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')

    await expect(page.getByRole('heading', { name: /pipeline stacks/i })).toBeVisible()
  })

  test('pipeline stacks card shows empty state or existing stacks', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')

    await expect(page.getByRole('button', { name: /add stack/i })).toBeVisible()
    const emptyState = page.getByText(/no pipeline stacks configured/i)
    const stackItem = page.locator('[data-testid="stack-item"]').first()
    await expect(emptyState.or(stackItem)).toBeVisible({ timeout: 5000 })
  })

  test('"Add Stack" button opens the modal', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')

    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /add pipeline stack/i })).toBeVisible()
  })

  test('modal contains all required fields', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    /*
     * Scoped to the dialog, and asserting what the dialog actually has.
     *
     * Every one of these used to be a document-level query, and the product
     * edit page behind the modal mounts eight `<dialog>` elements plus its own
     * form. Measured against a live page, the modal holds exactly three fields
     * and the Add Step button — so:
     *
     *   - `/^name$/i` is anchored and does NOT match this field, whose
     *     accessible name is "Name*"; `Input` appends the required marker. It
     *     was matching the product's own Name field on the page behind.
     *   - `/webhook url/i` and `/webhook token/i` are not in this modal AT ALL.
     *     They belong to "Add Webhook", a different dialog on the same page,
     *     and the assertions were passing by finding that one.
     *
     * (#305)
     */
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel(/^name\*?$/i)).toBeVisible()
    await expect(dialog.getByLabel(/^environment\*?$/i)).toBeVisible()
    await expect(dialog.getByLabel(/state key parameter/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /\+ add step/i })).toBeVisible()
  })

  test('"Add Step" button adds a step form inside the modal', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 1/i)).toBeVisible()
    await expect(page.getByLabel(/template/i)).toBeVisible()
    await expect(page.getByLabel(/state suffix/i)).toBeVisible()
  })

  test('adding two steps shows step 1 and step 2', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()

    await expect(page.getByText(/step 1/i)).toBeVisible()
    await expect(page.getByText(/step 2/i)).toBeVisible()
  })

  test('removing a step decreases step count', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
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
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const submitBtn = page.getByRole('button', { name: /^add$/i })
    await expect(submitBtn).toBeDisabled()
  })

  test('cancel button closes the modal', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('"Edit Stack" button opens modal pre-filled with stack data', async ({ page }) => {
    // By NAME, not "the first product". The demo seeds a pipeline stack for one
    // offering only — the same `Managed Nginx Gateway` the provisioning journey
    // uses — so opening whichever product sorts first found a product with no
    // stacks and skipped, every run, whatever DEMO_CI_URL said.
    requireSeeded(await openProductEditByName(page, STACKED_PRODUCT), `no ${STACKED_PRODUCT} on /admin/products`)

    /*
     * Waited for, not read once. `stacks` starts empty and the panel paints its
     * "No pipeline stacks configured" state before the fetch resolves, so
     * `noStacks.isVisible()` was true on a product that has one — and the test
     * concluded there was no stack to edit. `appears` waits for the row itself
     * and answers false only when none ever arrives.
     */
    const stackItem = page.locator('[data-testid="stack-item"]').first()
    requireStack(await appears(stackItem), 'the product has no pipeline stack to edit')

    await stackItem.getByRole('button', { name: /^edit$/i }).click()

    /*
     * Scoped to the dialog, and the label allows its required marker.
     *
     * `page.getByLabel(/^name$/i)` was both unscoped — the page behind the modal
     * has its own Name field — and anchored, so it matched nothing at all:
     * `Input` renders a required field's label as "Name*". Two ways to be wrong
     * about the same locator, neither of which anyone saw, because the guard
     * above skipped the test before it ever got here.
     */
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByRole('heading', { name: /edit pipeline stack/i })).toBeVisible()
    await expect(dialog.getByLabel(/^name\s*\*?$/i)).not.toBeEmpty()
  })
})

test.describe('Admin - Pipeline Stacks: full create → delete flow', () => {
  test('create a pipeline stack and verify it appears, then delete it', async ({ page }) => {
    await loginAsRoot(page)
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')

    // Check if an environment is configured — required for the form select
    const envSelector = page.locator('select')
    const hasEnv = await envSelector.count() > 0

    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    if (!hasEnv) {
      // Closed before bailing out, so a failure screenshot shows the page rather
      // than a modal sitting on top of it.
      await page.getByRole('button', { name: /cancel/i }).click()
      requireSeeded(false, 'the stack modal offers no environment to bind a stack to')
      return
    }

    /*
     * Scoped, and matching the real accessible names. `Input` appends the
     * required marker, so the field is "Name*" and an anchored `/^name$/i`
     * matches nothing inside the dialog — it used to find the product's own
     * Name field on the page behind and type the stack name into THAT (#305).
     *
     * The webhook URL and token lines are gone because those fields are not in
     * this modal: a stack inherits its trigger from the deployment environment
     * (`pipelineStackInheritNotice` says so on the form itself). They were
     * being filled in the "Add Webhook" dialog next door.
     */
    const form = page.getByRole('dialog')
    await form.getByLabel(/^name\*?$/i).fill('E2E Test Stack')
    const envSelect = form.getByLabel(/^environment\*?$/i)
    const firstOption = envSelect.locator('option').nth(1)
    const optionExists = await firstOption.count() > 0
    if (!optionExists) {
      await form.getByRole('button', { name: /cancel/i }).click()
      requireSeeded(false, 'the stack form offers no CI source to build the stack from')
      return
    }
    await envSelect.selectOption({ index: 1 })

    // Add a step
    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 1/i)).toBeVisible()
    await form.getByLabel(/template/i).fill('linode/virtual-machine')
    await form.getByLabel(/state suffix/i).fill('-vm')

    // Submit
    await form.getByRole('button', { name: /^add$/i }).click()

    // Stack should appear in the list — asserted on the stack's OWN row.
    //
    // Unscoped, `/1 step/i` matched every stack on the page that has one step.
    // This PR seeds a pipeline stack into the demo catalogue, so that went from
    // one match to two and the assertion failed as a strict mode violation. The
    // seed is the point — without a stack no seeded product is provisionable,
    // which is what kept the whole order flow skipping — so the assertion is
    // what has to become specific, not the data.
    // `data-testid="stack-item"`, not a div filtered by text. `locator('div')`
    // matches every ancestor containing the string too, so on a page that has
    // grown — the size matrix arrived in #249 — the filter resolves to a stack of
    // nested divs and a click lands on whichever Playwright picks (#296). Defined
    // once here and used for the assertions and the delete alike.
    const row = page.locator('[data-testid="stack-item"]').filter({ hasText: 'E2E Test Stack' })
    await expect(row).toBeVisible({ timeout: 5000 })
    await expect(row.getByText(/1 step/i)).toBeVisible()

    // Delete the stack
    const deleteBtn = row.getByRole('button', { name: /delete/i })
    await deleteBtn.click()

    // Stack should be removed
    await expect(page.getByText('E2E Test Stack')).not.toBeVisible({ timeout: 3000 })
  })

  test('step form exposes Exec Order and Upstream State Refs (v2 features)', async ({ page }) => {
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
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
    requireSeeded(await openFirstProductEdit(page), 'no product on /admin/products to edit')
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
