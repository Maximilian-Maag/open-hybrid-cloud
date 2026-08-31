import { test, expect } from './fixtures'
import { loginAsRoot, expectNoServerError } from './helpers'

/**
 * Open the first catalogue product, or say the catalogue is empty.
 *
 * Three tests did this by clicking the tile's Details link and asserting the
 * URL. That is a Next.js `<Link>`, inert until React hydrates, while
 * Playwright's actionability checks are satisfied by the server-rendered
 * anchor — so the click reported success and the page stayed put. Navigating
 * by `href` still proves the tile points at a real detail page, which is all
 * the click was demonstrating (#296).
 */
async function openFirstProduct(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/catalog')
  const detailLinks = page.getByRole('link', { name: /^details\b/i })
  const noProducts = page.getByText(/no products found/i)
  await expect(detailLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
  if (await noProducts.isVisible()) return false

  const href = await detailLinks.first().getAttribute('href')
  expect(href, 'a catalogue tile has a Details link with no href').toBeTruthy()
  await page.goto(href as string)
  // Generous: the first request for this route compiles it in a dev server.
  await expect(page).toHaveURL(/\/catalog\/\d+/, { timeout: 30_000 })
  return true
}

test.describe('Product Detail Page', () => {
  test('product detail page loads from a catalogue tile', async ({ page }) => {
    await loginAsRoot(page)
    if (!(await openFirstProduct(page))) { test.skip(); return }
    await expectNoServerError(page)
  })

  test('product detail page shows description and environments', async ({ page }) => {
    await loginAsRoot(page)
    if (!(await openFirstProduct(page))) { test.skip(); return }

    /*
     * The page's own `<h1>`, not "the first h1 or h2".
     *
     * The product gallery mounts a lightbox `<dialog>` whose `<h2>Product
     * images</h2>` comes first in document order, so `locator('h1, h2').first()`
     * resolved to a heading inside a CLOSED dialog and asserted that a hidden
     * element is visible. The suite only saw it once #185 gave these pages an
     * h1 and moved the cards to h2 — before that the ordering happened to
     * favour something visible (#296).
     *
     * `getByRole` also excludes hidden elements by construction, which is the
     * property `locator()` lacks and the reason this was possible at all.
     */
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('product detail page shows order form with environment selector', async ({ page }) => {
    await loginAsRoot(page)
    if (!(await openFirstProduct(page))) { test.skip(); return }

    // The order form always renders with environment and project selects
    await expect(page.getByLabel(/select environment/i).or(page.getByText(/available environments/i))).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Order Placement Flow', () => {
  test('can submit an order and see it in the orders list', async ({ page }) => {
    await loginAsRoot(page)
    if (!(await openFirstProduct(page))) { test.skip(); return }

    // Check if environments are available (product may have zero environments configured)
    // Scoped to the order form: the buy box has an environment select of its own,
    // so an unscoped label match is ambiguous. (It used to match nothing at all —
    // "Select environment…" is the placeholder option, not the label — so this
    // test always skipped here.)
    const envSelect = page.locator('#order').getByLabel(/environment/i)
    const noEnvText = page.getByText(/no environments|not configured/i)
    await expect(envSelect.or(noEnvText).first()).toBeVisible({ timeout: 5000 })
    if (await noEnvText.isVisible()) { test.skip(); return }

    // Check if there are selectable environment options (not just placeholder)
    const envOptions = envSelect.locator('option').filter({ hasNot: page.locator('[disabled]') })
    const optCount = await envOptions.count()
    if (optCount <= 1) { test.skip(); return } // only placeholder option

    // Select the first real environment
    await envSelect.selectOption({ index: 1 })

    // Select a project if available
    const projectSelect = page.locator('#order').getByLabel(/project/i)
    if (await projectSelect.isVisible()) {
      const projectOptions = projectSelect.locator('option')
      if (await projectOptions.count() > 1) {
        await projectSelect.selectOption({ index: 1 })
      }
    }

    // A required parameter needs a value this test cannot invent per product, so
    // fill the text inputs generically and skip if anything required is still empty.
    const requiredInputs = page.locator('#order input[required]')
    for (let i = 0; i < await requiredInputs.count(); i++) {
      const input = requiredInputs.nth(i)
      if ((await input.inputValue()) === '') await input.fill('e2e-order-flow')
    }

    // Submit the order
    const submitButton = page.locator('#order').getByRole('button', { name: /place order/i })
    if (!await submitButton.isVisible()) { test.skip(); return }
    await submitButton.click()

    /*
     * Two legitimate outcomes, and the refusal is checked FIRST because it is
     * the one the seeded catalogue actually produces.
     *
     * A product with no pipeline stack and no webhook cannot be provisioned, so
     * the order is refused with an explanation rather than accepted and left
     * hanging — the guard #206 added. The demo seed creates a CI source and two
     * environments but no stack, so nothing in the seeded catalogue is
     * orderable, and this test cannot reach its happy path until that changes
     * (#157).
     *
     * Skipped with the reason rather than failing on a redirect that was never
     * going to happen. The refusal itself is asserted on the way past, so this
     * is a known gap rather than a test that quietly does nothing.
     */
    const refused = page.getByText(/nothing to provision it|no pipeline configured/i).first()
    const redirected = page.waitForURL(/\/orders/, { timeout: 30_000 }).then(() => 'redirected' as const)
    const explained = refused.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'refused' as const)
    const outcome = await Promise.race([redirected, explained]).catch(() => 'neither' as const)

    if (outcome === 'refused') {
      await expect(refused).toBeVisible()
      test.skip(true, 'the seeded product has no pipeline stack, so it cannot be ordered — see #157')
      return
    }
    expect(outcome, 'the order neither went through nor said why').toBe('redirected')
    await expect(page).toHaveURL(/\/orders/)
  })

  test('order detail page shows order information', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/orders')

    // Wait for orders table
    const table = page.getByRole('table')
    await expect(table).toBeVisible({ timeout: 5000 })

    // Find any order link (#N format)
    const orderLinks = page.getByRole('link').filter({ hasText: /^#\d+$/ })
    const count = await orderLinks.count()
    if (count === 0) { test.skip(); return }

    await orderLinks.first().click()
    // 30s, like auth.setup.ts: the suite runs against `next dev`, which compiles
    // /orders/[id] on first request, and under parallel workers that outlasts the
    // 5s default. (These two tests only started running once the database had
    // orders in it — see issue #89.)
    await expect(page).toHaveURL(/\/orders\/\d+/, { timeout: 30_000 })
    await expectNoServerError(page)

    // Order detail always shows these sections
    await expect(page.getByText(/product/i).first()).toBeVisible()
    await expect(page.getByText(/status/i).first()).toBeVisible()
    await expect(page.getByText(/environment/i).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /back to orders/i })).toBeVisible()
  })

  test('Back to Orders button on order detail navigates to orders list', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/orders')

    const orderLinks = page.getByRole('link').filter({ hasText: /^#\d+$/ })
    if (await orderLinks.count() === 0) { test.skip(); return }

    await orderLinks.first().click()
    // 30s, like auth.setup.ts: the suite runs against `next dev`, which compiles
    // /orders/[id] on first request, and under parallel workers that outlasts the
    // 5s default. (These two tests only started running once the database had
    // orders in it — see issue #89.)
    await expect(page).toHaveURL(/\/orders\/\d+/, { timeout: 30_000 })

    await page.getByRole('link', { name: /back to orders/i }).click()
    await expect(page).toHaveURL(/\/orders$/)
  })
})

test.describe('Catalog - Category Filter', () => {
  test('clicking a category filters the product list', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/catalog')

    // Wait for catalog to finish loading
    await expect(
      page.getByRole('link', { name: /^details\b/i }).or(page.getByText(/no products found/i)).first()
    ).toBeVisible({ timeout: 10000 })

    // Check if there are category filter buttons (sidebar for md+, pills for mobile)
    const categoryButtons = page.getByRole('button').filter({ hasNot: page.getByText(/all products|^all$/i) })
    const catCount = await categoryButtons.count()
    if (catCount === 0) { test.skip(); return } // no categories configured

    // Click the first category button
    await categoryButtons.first().click()

    // After clicking, page still shows either products or empty state (no 500 error)
    await expectNoServerError(page)
    await expect(
      page.getByRole('link', { name: /^details\b/i }).or(page.getByText(/no products found/i)).first()
    ).toBeVisible({ timeout: 5000 })

    // Click "All products" to reset
    await page.getByRole('button', { name: /all products/i }).click()
    await expect(
      page.getByRole('link', { name: /^details\b/i }).or(page.getByText(/no products found/i)).first()
    ).toBeVisible({ timeout: 5000 })
  })
})
