import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Category Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/categories')
    await expect(page.getByRole('button', { name: /add category/i })).toBeVisible({ timeout: 8000 })
  })

  test('categories page shows title and Add Category button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^categories$/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /add category/i })).toBeVisible()
  })

  test('Add Category opens modal with Name and Display Order fields', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click()
    await expect(page.getByRole('heading', { name: /add category/i })).toBeVisible()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByLabel(/display order/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible()
  })

  test('can create, edit and delete a category', async ({ page }) => {
    const catName = `E2E Cat ${Date.now()}`

    // --- Create ---
    await page.getByRole('button', { name: /add category/i }).click()
    await page.locator('dialog[open]').getByLabel(/^name/i).fill(catName)
    await page.locator('dialog[open]').getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByRole('heading', { name: /add category/i })).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(catName)).toBeVisible({ timeout: 8000 })

    // --- Edit ---
    const catRow = page.locator('div').filter({ has: page.getByText(catName) }).filter({ has: page.getByRole('button', { name: /^edit$/i }) }).last()
    await catRow.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByRole('heading', { name: /edit category/i })).toBeVisible()
    const updatedName = `${catName} Updated`
    await page.locator('dialog[open]').getByLabel(/^name/i).fill(updatedName)
    await page.locator('dialog[open]').getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByRole('heading', { name: /edit category/i })).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 8000 })

    // --- Delete ---
    const updatedRow = page.locator('div').filter({ has: page.getByText(updatedName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await updatedRow.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete category/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.getByText(updatedName)).not.toBeVisible({ timeout: 8000 })
  })

  test('Cancel on Add Category modal closes without creating', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click()
    await expect(page.getByRole('heading', { name: /add category/i })).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('heading', { name: /add category/i })).not.toBeVisible({ timeout: 3000 })
  })
})
