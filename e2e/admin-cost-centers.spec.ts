import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Cost Center Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/cost-centers')
    await expect(page.getByRole('button', { name: /add cost center/i })).toBeVisible({ timeout: 8000 })
  })

  test('cost centers page shows title and Add Cost Center button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /cost centers/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /add cost center/i })).toBeVisible()
  })

  test('Add Cost Center modal has Code and Name fields', async ({ page }) => {
    await page.getByRole('button', { name: /add cost center/i }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByLabel(/^code/i)).toBeVisible()
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible()
  })

  test('can create, edit and delete a cost center', async ({ page }) => {
    const ts = Date.now()
    const code = `E2E${ts}`.slice(-8)
    const name = `E2E CC ${ts}`

    // --- Create ---
    await page.getByRole('button', { name: /add cost center/i }).click()
    const addDialog = page.locator('dialog[open]')
    await addDialog.getByLabel(/^code/i).fill(code)
    await addDialog.getByLabel(/^name/i).fill(name)
    await addDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 8000 })

    // --- Edit ---
    const ccRow = page.locator('div').filter({ has: page.getByText(name) }).filter({ has: page.getByRole('button', { name: /^edit$/i }) }).last()
    await ccRow.getByRole('button', { name: /^edit$/i }).click()
    const editDialog = page.locator('dialog[open]')
    const updatedName = `${name} Updated`
    await editDialog.getByLabel(/^name/i).fill(updatedName)
    await editDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 8000 })

    // --- Delete ---
    const updatedRow = page.locator('div').filter({ has: page.getByText(updatedName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await updatedRow.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete cost center/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedName)).not.toBeVisible({ timeout: 8000 })
  })
})
