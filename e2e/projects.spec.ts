import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/projects')
  })

  test('projects page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows page title "Projects"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^projects$/i })).toBeVisible()
  })

  test('shows projects subtitle', async ({ page }) => {
    await expect(page.getByText(/manage your infrastructure projects/i)).toBeVisible()
  })

  test('shows New Project button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible()
  })

  test('clicking New Project opens a modal with a Name field', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click()
    // Required inputs add "*" to the label, so accessible name is "Name *" — use getByLabel with partial match
    await expect(page.getByLabel(/name/i).first()).toBeVisible()
  })

  test('New Project modal has Description textarea', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page.locator('textarea').first()).toBeVisible()
  })

  test('New Project modal has Create Project and Cancel buttons', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page.getByRole('button', { name: /create project/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
  })

  test('submitting without a name keeps the modal open', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click()
    await page.getByRole('button', { name: /create project/i }).click()
    // Native HTML5 required validation or React error — either way the button is still visible
    await expect(page.getByRole('button', { name: /create project/i })).toBeVisible()
  })

  test('can create a new project', async ({ page }) => {
    const projectName = `E2E Project ${Date.now()}`
    await page.getByRole('button', { name: /new project/i }).click()
    // Fill the Name field (label includes "*" for required, so use getByLabel with partial match)
    await page.getByLabel(/^name/i).fill(projectName)
    await page.getByRole('button', { name: /create project/i }).click()
    // Modal should close after successful creation
    await expect(page.getByRole('button', { name: /create project/i })).not.toBeVisible({ timeout: 8000 })
    // Project name should appear after router.refresh() re-fetches the server component
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 12000 })
  })

  test('Cancel button closes the modal', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page.getByLabel(/^name/i).first()).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('button', { name: /create project/i })).not.toBeVisible({ timeout: 3000 })
  })

  test('shows project table with header row', async ({ page }) => {
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('table').getByRole('row').first()).toBeVisible()
  })

  test('project rows link to project detail page', async ({ page }) => {
    const dataRows = page.getByRole('table').getByRole('row').filter({ hasNot: page.getByRole('columnheader') })
    const count = await dataRows.count()
    if (count > 0) {
      const firstLink = dataRows.first().getByRole('link').first()
      if (await firstLink.count() > 0) {
        await firstLink.click()
        await expect(page).toHaveURL(/\/projects\/\d+/)
      }
    }
  })
})

test.describe('Project detail', () => {
  test('project detail page shows edit form', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/projects')

    const dataRows = page.getByRole('table').getByRole('row').filter({ hasNot: page.getByRole('columnheader') })
    const count = await dataRows.count()
    if (count === 0) {
      test.skip()
      return
    }

    const firstLink = dataRows.first().getByRole('link').first()
    if (await firstLink.count() === 0) { test.skip(); return }
    await firstLink.click()
    await expect(page).toHaveURL(/\/projects\/\d+/, { timeout: 5000 })

    await expect(page.getByText(/project details/i)).toBeVisible()
    // Required name field: label shows "Name *"
    await expect(page.getByLabel(/^name/i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeVisible()
  })

  test('saving project changes shows success message', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/projects')

    const dataRows = page.getByRole('table').getByRole('row').filter({ hasNot: page.getByRole('columnheader') })
    if (await dataRows.count() === 0) { test.skip(); return }
    const firstLink = dataRows.first().getByRole('link').first()
    if (await firstLink.count() === 0) { test.skip(); return }
    await firstLink.click()
    await expect(page).toHaveURL(/\/projects\/\d+/, { timeout: 5000 })

    // Change the description field (safe — no side effects)
    const descField = page.getByLabel(/description/i).first()
    await descField.fill(`E2E edit ${Date.now()}`)
    await page.getByRole('button', { name: /save changes/i }).click()
    await expect(page.getByText(/project saved/i)).toBeVisible({ timeout: 8000 })
  })

  test('can delete a project', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/projects')

    // Create a temporary project to delete
    const projectName = `Delete Me ${Date.now()}`
    await page.getByRole('button', { name: /new project/i }).click()
    await page.getByLabel(/^name/i).fill(projectName)
    await page.getByRole('button', { name: /create project/i }).click()
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 12000 })

    // Navigate to the project detail
    await page.getByText(projectName).click()
    await expect(page).toHaveURL(/\/projects\/\d+/)

    // Open delete confirmation modal and confirm
    await page.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete project/i })).toBeVisible()
    // The modal has a Cancel and a Delete button; click the danger Delete button
    await page.getByRole('button', { name: /^delete$/i }).last().click()

    // Should redirect back to /projects list
    await expect(page).toHaveURL(/\/projects$/, { timeout: 8000 })
    await expect(page.getByText(projectName)).not.toBeVisible({ timeout: 5000 })
  })

  test('Delete button opens confirmation modal', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/projects')

    const dataRows = page.getByRole('table').getByRole('row').filter({ hasNot: page.getByRole('columnheader') })
    if (await dataRows.count() === 0) { test.skip(); return }

    const firstLink = dataRows.first().getByRole('link').first()
    if (await firstLink.count() === 0) { test.skip(); return }
    await firstLink.click()
    await expect(page).toHaveURL(/\/projects\/\d+/, { timeout: 5000 })

    await page.getByRole('button', { name: /^delete$/i }).click()

    await expect(page.getByRole('heading', { name: /delete project/i })).toBeVisible()
    await expect(page.getByText(/this action cannot be undone/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
  })
})
