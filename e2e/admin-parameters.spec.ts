import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Global Parameters Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/parameters')
    await expect(page.getByRole('button', { name: /add parameter/i })).toBeVisible({ timeout: 8000 })
  })

  test('parameters page shows title and Add Parameter button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /global parameters/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /add parameter/i })).toBeVisible()
  })

  test('Add Parameter modal has Name, Type and Description fields', async ({ page }) => {
    await page.getByRole('button', { name: /add parameter/i }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByLabel(/^type/i)).toBeVisible()
    await expect(dialog.getByLabel(/description/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible()
  })

  test('can create, edit and delete a global parameter', async ({ page }) => {
    const ts = Date.now()
    const paramName = `e2e_param_${ts}`

    // --- Create ---
    await page.getByRole('button', { name: /add parameter/i }).click()
    const addDialog = page.locator('dialog[open]')
    await addDialog.getByLabel(/^name/i).fill(paramName)
    await addDialog.getByLabel(/description/i).fill('E2E test parameter')
    await addDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(paramName)).toBeVisible({ timeout: 8000 })

    // --- Edit ---
    const paramRow = page.locator('div').filter({ has: page.getByText(paramName) }).filter({ has: page.getByRole('button', { name: /^edit$/i }) }).last()
    await paramRow.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByRole('heading', { name: /edit parameter/i })).toBeVisible()
    const updatedName = `${paramName}_updated`
    await page.locator('dialog[open]').getByLabel(/^name/i).fill(updatedName)
    await page.locator('dialog[open]').getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByRole('heading', { name: /edit parameter/i })).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 8000 })

    // --- Delete ---
    const updatedRow = page.locator('div').filter({ has: page.getByText(updatedName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await updatedRow.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete parameter/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.getByText(updatedName)).not.toBeVisible({ timeout: 8000 })
  })

  test('parameter type dropdown has expected options', async ({ page }) => {
    await page.getByRole('button', { name: /add parameter/i }).click()
    const dialog = page.locator('dialog[open]')
    const typeSelect = dialog.getByLabel(/^type/i)
    await expect(typeSelect.locator('option', { hasText: /string/i })).toBeAttached()
    await expect(typeSelect.locator('option', { hasText: /number/i })).toBeAttached()
    await expect(typeSelect.locator('option', { hasText: /bool/i })).toBeAttached()
    await expect(typeSelect.locator('option', { hasText: /dropdown/i })).toBeAttached()
  })
})
