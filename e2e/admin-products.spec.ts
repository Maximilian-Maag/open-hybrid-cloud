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
})
