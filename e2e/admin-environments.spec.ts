import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Environment Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/environments')
    await expect(page.getByRole('button', { name: /add environment/i })).toBeVisible({ timeout: 8000 })
  })

  test('environments page shows title and Add Environment button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^environments$/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /add environment/i })).toBeVisible()
  })

  test('Add Environment modal has Name, CI Source, and URL fields', async ({ page }) => {
    await page.getByRole('button', { name: /add environment/i }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByLabel(/^name/i)).toBeVisible()
    await expect(dialog.getByLabel(/ci source/i)).toBeVisible()
    await expect(dialog.getByLabel(/webhook url/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible()
  })

  test('can create, edit and delete an environment when a CI source exists', async ({ page }) => {
    // First ensure a CI source exists (create one via UI if needed)
    await page.goto('/admin/ci-sources')
    await expect(page.getByRole('button', { name: /add ci source/i })).toBeVisible({ timeout: 8000 })

    const ts = Date.now()
    const ciName = `E2E CI for Env ${ts}`

    // Create a CI source for the environment to use
    await page.getByRole('button', { name: /add ci source/i }).click()
    const ciDialog = page.locator('dialog[open]')
    await ciDialog.getByLabel(/^name/i).fill(ciName)
    await ciDialog.getByLabel(/^url/i).fill('https://gitlab.example.com')
    await ciDialog.getByLabel(/^access token/i).fill('glpat-token')
    await ciDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByText(ciName)).toBeVisible({ timeout: 8000 })

    // Now go to environments
    await page.goto('/admin/environments')
    await expect(page.getByRole('button', { name: /add environment/i })).toBeVisible({ timeout: 8000 })

    const envName = `E2E Env ${ts}`

    // --- Create environment ---
    await page.getByRole('button', { name: /add environment/i }).click()
    const addDialog = page.locator('dialog[open]')
    await addDialog.getByLabel(/^name/i).fill(envName)
    // Select the CI source we just created
    const ciSelect = addDialog.getByLabel(/ci source/i)
    await ciSelect.selectOption({ label: new RegExp(ciName, 'i') })
    await addDialog.getByLabel(/webhook url/i).fill('https://gitlab.example.com/api/v4/projects/1/trigger/pipeline')
    await addDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(envName)).toBeVisible({ timeout: 8000 })

    // --- Edit environment ---
    const envRow = page.locator('div').filter({ has: page.getByText(envName) }).filter({ has: page.getByRole('button', { name: /^edit$/i }) }).last()
    await envRow.getByRole('button', { name: /^edit$/i }).click()
    const editDialog = page.locator('dialog[open]')
    const updatedEnvName = `${envName} Updated`
    await editDialog.getByLabel(/^name/i).fill(updatedEnvName)
    await editDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(updatedEnvName)).toBeVisible({ timeout: 8000 })

    // --- Delete environment ---
    const updatedEnvRow = page.locator('div').filter({ has: page.getByText(updatedEnvName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await updatedEnvRow.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete environment/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.getByText(updatedEnvName)).not.toBeVisible({ timeout: 8000 })

    // --- Clean up CI source ---
    await page.goto('/admin/ci-sources')
    await expect(page.getByText(ciName)).toBeVisible({ timeout: 8000 })
    const ciRow = page.locator('div').filter({ has: page.getByText(ciName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await ciRow.getByRole('button', { name: /^delete$/i }).click()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
  })
})
