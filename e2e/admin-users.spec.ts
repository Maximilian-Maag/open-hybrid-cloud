import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - User Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/users')
    // Wait for client component to finish loading
    await expect(page.getByRole('button', { name: /add user/i })).toBeVisible({ timeout: 8000 })
  })

  test('user management page shows title and Add User button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^users$/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /add user/i })).toBeVisible()
  })

  test('Add User opens modal with required fields', async ({ page }) => {
    await page.getByRole('button', { name: /add user/i }).click()
    await expect(page.getByRole('heading', { name: /add user/i })).toBeVisible()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByLabel(/^email/i)).toBeVisible()
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByLabel(/^role/i)).toBeVisible()
    await expect(dialog.getByLabel(/^password/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^create$/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
  })

  test('can create, edit, deactivate and delete a user', async ({ page }) => {
    const ts = Date.now()
    const email = `e2e-${ts}@example.com`
    const name = `E2E User ${ts}`

    // --- Create ---
    await page.getByRole('button', { name: /add user/i }).click()
    const addDialog = page.locator('dialog[open]')
    await addDialog.getByLabel(/^email/i).fill(email)
    await addDialog.getByLabel(/^name/i).fill(name)
    await addDialog.getByLabel(/^password/i).fill('E2eTest123!')
    await addDialog.getByRole('button', { name: /^create$/i }).click()
    // Modal should close and user should appear in list
    await expect(page.getByRole('heading', { name: /add user/i })).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(email)).toBeVisible({ timeout: 8000 })

    // --- Edit ---
    const userRow = page.locator('div').filter({ has: page.getByText(email) }).filter({ has: page.getByRole('button', { name: /^edit$/i }) }).last()
    await userRow.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByRole('heading', { name: /edit user/i })).toBeVisible()
    const updatedName = `E2E Updated ${ts}`
    await page.locator('dialog[open]').getByLabel(/^name/i).fill(updatedName)
    await page.locator('dialog[open]').getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByRole('heading', { name: /edit user/i })).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 8000 })

    // --- Deactivate ---
    const updatedRow = page.locator('div').filter({ has: page.getByText(email) }).filter({ has: page.getByRole('button', { name: /deactivate/i }) }).last()
    await updatedRow.getByRole('button', { name: /deactivate/i }).click()
    await expect(updatedRow.getByRole('button', { name: /activate/i })).toBeVisible({ timeout: 5000 })

    // --- Delete ---
    const rowForDelete = page.locator('div').filter({ has: page.getByText(email) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await rowForDelete.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete user/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.getByText(email)).not.toBeVisible({ timeout: 8000 })
  })

  test('Cancel on Add User modal closes it without creating a user', async ({ page }) => {
    await page.getByRole('button', { name: /add user/i }).click()
    await expect(page.getByRole('heading', { name: /add user/i })).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('heading', { name: /add user/i })).not.toBeVisible({ timeout: 3000 })
  })
})
