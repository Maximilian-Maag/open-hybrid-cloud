import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - CI Sources Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/ci-sources')
    await expect(page.getByRole('button', { name: /add ci source/i })).toBeVisible({ timeout: 8000 })
  })

  test('CI sources page shows title and Add CI Source button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /ci sources/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /add ci source/i })).toBeVisible()
  })

  test('Add CI Source modal has Name, Provider, URL and Token fields', async ({ page }) => {
    await page.getByRole('button', { name: /add ci source/i }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByLabel(/provider/i)).toBeVisible()
    await expect(dialog.getByLabel(/^url/i)).toBeVisible()
    await expect(dialog.getByLabel(/^access token/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible()
  })

  test('can create, edit and delete a CI source', async ({ page }) => {
    const ts = Date.now()
    const name = `E2E CI ${ts}`

    // --- Create ---
    await page.getByRole('button', { name: /add ci source/i }).click()
    const addDialog = page.locator('dialog[open]')
    await addDialog.getByLabel(/^name/i).fill(name)
    await addDialog.getByLabel(/^url/i).fill('https://gitlab.example.com')
    await addDialog.getByLabel(/^access token/i).fill('glpat-test-token')
    await addDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 8000 })

    // --- Edit ---
    const srcRow = page.locator('div').filter({ has: page.getByText(name) }).filter({ has: page.getByRole('button', { name: /^edit$/i }) }).last()
    await srcRow.getByRole('button', { name: /^edit$/i }).click()
    const editDialog = page.locator('dialog[open]')
    const updatedName = `${name} Updated`
    await editDialog.getByLabel(/^name/i).fill(updatedName)
    await editDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 8000 })

    // --- Delete ---
    const updatedRow = page.locator('div').filter({ has: page.getByText(updatedName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await updatedRow.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete ci source/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.getByText(updatedName)).not.toBeVisible({ timeout: 8000 })
  })
})
