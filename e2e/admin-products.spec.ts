import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Product Delete Button', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/products')
    await expect(page.getByRole('heading', { name: /^products$/i, level: 1 })).toBeVisible({ timeout: 8000 })
  })

  test('list row shows both Edit and Delete buttons', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit$/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    // At least one row exposes a Delete button next to the Edit link
    await expect(page.getByRole('button', { name: /^delete$/i }).first()).toBeVisible()
  })

  test('clicking Delete opens confirmation modal warning about cascade decommission', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit$/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await page.getByRole('button', { name: /^delete$/i }).first().click()

    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: /delete product/i })).toBeVisible()
    // Warning surface: cascade decommission is called out so the Root user knows the blast radius
    await expect(dialog.getByText(/decommissioned/i)).toBeVisible()
    await expect(dialog.getByText(/destroy webhook/i)).toBeVisible()
  })

  test('Cancel closes the modal without deleting', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit$/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    const productCountBefore = await page.getByRole('button', { name: /^delete$/i }).count()

    await page.getByRole('button', { name: /^delete$/i }).first().click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).not.toBeVisible()

    // Row count unchanged
    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(productCountBefore)
  })

  // Happy path: create a throw-away product, delete via UI, verify it's gone.
  // Requires at least one category to exist (bootstrap seeds none, so create
  // one via the admin UI first).
  test('creates a product, deletes it via the confirmation dialog, and verifies it is removed', async ({ page }) => {
    const ts = Date.now()
    const productName = `E2E Delete ${ts}`
    const categoryName = `E2E Cat ${ts}`

    // Seed a category so the New Product form has something to select
    await page.goto('/admin/categories')
    await expect(page.getByRole('button', { name: /add category/i })).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /add category/i }).click()
    let dialog = page.locator('dialog[open]')
    await dialog.getByLabel(/^name/i).fill(categoryName)
    await dialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByText(categoryName)).toBeVisible({ timeout: 8000 })

    // Create the product
    await page.goto('/admin/products/new')
    await page.getByLabel(/^name/i).fill(productName)
    await page.getByLabel(/^description/i).fill('created solely to be deleted')
    await page.getByLabel(/category/i).selectOption({ label: categoryName })
    await page.getByRole('button', { name: /save|create/i }).click()

    // After create the form redirects to the edit page — go back to the list
    await page.goto('/admin/products')
    await expect(page.getByRole('link', { name: productName })).toBeVisible({ timeout: 8000 })

    // Confirm-delete the product
    const productRow = page.locator('tr').filter({ has: page.getByRole('link', { name: productName }) })
    await productRow.getByRole('button', { name: /^delete$/i }).click()

    dialog = page.locator('dialog[open]')
    await expect(dialog.getByRole('heading', { name: /delete product/i })).toBeVisible()
    // Cascade-decommission warning is present (tested elsewhere) — proceed with confirm
    await dialog.getByRole('button', { name: /^delete$/i }).click()

    // Wait for the row to disappear from the list
    await expect(page.getByRole('link', { name: productName })).not.toBeVisible({ timeout: 8000 })

    // Cleanup: remove the category we seeded
    await page.goto('/admin/categories')
    const catRow = page.locator('div').filter({ has: page.getByText(categoryName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await catRow.getByRole('button', { name: /^delete$/i }).click()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
  })
})

test.describe('Admin - Product Environment Removal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  // The Remove button only appears for environments the product is actually
  // linked to, so this needs a product with a saved offering. Skips cleanly on a
  // stack with no products or no deployment environments configured.
  test('Remove asks for confirmation and explains what is discarded', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /^edit$/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    const envCard = page.locator('div').filter({ has: page.getByRole('heading', { name: /^environments$/i }) }).last()
    await expect(envCard).toBeVisible({ timeout: 8000 })

    const remove = envCard.getByRole('button', { name: /^remove$/i }).first()
    if (await remove.count() === 0) { test.skip(); return }

    await remove.click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: /^remove .+\?$/i })).toBeVisible()
    // Blast radius is spelled out: the offering goes, provisioned infra does not.
    await expect(dialog.getByText(/no longer be orderable/i)).toBeVisible()

    // Cancel leaves the offering in place.
    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).not.toBeVisible()
    await expect(envCard.getByRole('button', { name: /^remove$/i }).first()).toBeVisible()
  })
})

test.describe('Admin - Trial Offerings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  // Issue #1. Trials are opt-in per offering, so the duration field is gated on
  // the checkbox rather than always present.
  test('the trial duration appears only once the offering is opted in', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /^edit$/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    const trialToggle = page.getByLabel(/offer as trial/i).first()
    if (await trialToggle.count() === 0) { test.skip(); return }

    await expect(page.getByLabel(/trial duration/i)).toHaveCount(0)
    await trialToggle.check()
    await expect(page.getByLabel(/trial duration/i).first()).toBeVisible()
    // 30 minutes is the issue's number, carried as the default.
    await expect(page.getByLabel(/trial duration/i).first()).toHaveValue('30')

    // Leave the offering as it was.
    await trialToggle.uncheck()
  })
})
