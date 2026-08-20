import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Product Detail Page', () => {
  test('product detail page loads from a catalogue tile', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/catalog')

    // Wait for catalog to finish loading (client component)
    const placeOrderLinks = page.getByRole('link', { name: /^details$/i })
    const noProducts = page.getByText(/no products found/i)
    await expect(placeOrderLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })

    if (await noProducts.isVisible()) {
      test.skip()
      return
    }

    // Navigate to product detail
    await placeOrderLinks.first().click()
    await expect(page).toHaveURL(/\/catalog\/\d+/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('product detail page shows description and environments', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/catalog')

    const placeOrderLinks = page.getByRole('link', { name: /^details$/i })
    const noProducts = page.getByText(/no products found/i)
    await expect(placeOrderLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await placeOrderLinks.first().click()
    await expect(page).toHaveURL(/\/catalog\/\d+/)

    // Product detail always shows the page header with product name
    // and either a description or the available environments section
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('product detail page shows order form with environment selector', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/catalog')

    const placeOrderLinks = page.getByRole('link', { name: /^details$/i })
    const noProducts = page.getByText(/no products found/i)
    await expect(placeOrderLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await placeOrderLinks.first().click()
    await expect(page).toHaveURL(/\/catalog\/\d+/)

    // The order form always renders with environment and project selects
    await expect(page.getByLabel(/select environment/i).or(page.getByText(/available environments/i))).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Order Placement Flow', () => {
  test('can submit an order and see it in the orders list', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/catalog')

    // Wait for catalog to load
    const placeOrderLinks = page.getByRole('link', { name: /^details$/i })
    const noProducts = page.getByText(/no products found/i)
    await expect(placeOrderLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await placeOrderLinks.first().click()
    await expect(page).toHaveURL(/\/catalog\/\d+/)

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

    // Should redirect to /orders after submission
    await expect(page).toHaveURL(/\/orders/, { timeout: 10000 })
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
    await expect(page.locator('body')).not.toContainText('500')

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
      page.getByRole('link', { name: /^details$/i }).or(page.getByText(/no products found/i)).first()
    ).toBeVisible({ timeout: 10000 })

    // Check if there are category filter buttons (sidebar for md+, pills for mobile)
    const categoryButtons = page.getByRole('button').filter({ hasNot: page.getByText(/all products|^all$/i) })
    const catCount = await categoryButtons.count()
    if (catCount === 0) { test.skip(); return } // no categories configured

    // Click the first category button
    await categoryButtons.first().click()

    // After clicking, page still shows either products or empty state (no 500 error)
    await expect(page.locator('body')).not.toContainText('500')
    await expect(
      page.getByRole('link', { name: /^details$/i }).or(page.getByText(/no products found/i)).first()
    ).toBeVisible({ timeout: 5000 })

    // Click "All products" to reset
    await page.getByRole('button', { name: /all products/i }).click()
    await expect(
      page.getByRole('link', { name: /^details$/i }).or(page.getByText(/no products found/i)).first()
    ).toBeVisible({ timeout: 5000 })
  })
})
