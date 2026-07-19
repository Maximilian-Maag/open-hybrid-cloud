import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Pipeline Stacks', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  test('pipeline stacks card is visible on product edit page', async ({ page }) => {
    await page.goto('/admin/products')
    await expect(page.locator('body')).not.toContainText('500')

    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })

    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await expect(page).toHaveURL(/\/admin\/products\/\d+/)

    await expect(page.getByRole('heading', { name: /pipeline stacks/i })).toBeVisible()
  })

  test('pipeline stacks card shows empty state or existing stacks', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await expect(page).toHaveURL(/\/admin\/products\/\d+/)

    await expect(page.getByRole('button', { name: /add stack/i })).toBeVisible()
    const emptyState = page.getByText(/no pipeline stacks configured/i)
    const stackItem = page.locator('[data-testid="stack-item"]').first()
    await expect(emptyState.or(stackItem)).toBeVisible({ timeout: 5000 })
  })

  test('"Add Stack" button opens the modal', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await expect(page).toHaveURL(/\/admin\/products\/\d+/)

    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /add pipeline stack/i })).toBeVisible()
  })

  test('modal contains all required fields', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await expect(page.getByLabel(/^name$/i)).toBeVisible()
    await expect(page.getByLabel(/environment/i)).toBeVisible()
    await expect(page.getByLabel(/webhook url/i)).toBeVisible()
    await expect(page.getByLabel(/webhook token/i)).toBeVisible()
    await expect(page.getByLabel(/state key parameter/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /\+ add step/i })).toBeVisible()
  })

  test('"Add Step" button adds a step form inside the modal', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 1/i)).toBeVisible()
    await expect(page.getByLabel(/template/i)).toBeVisible()
    await expect(page.getByLabel(/state suffix/i)).toBeVisible()
  })

  test('adding two steps shows step 1 and step 2', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()

    await expect(page.getByText(/step 1/i)).toBeVisible()
    await expect(page.getByText(/step 2/i)).toBeVisible()
  })

  test('removing a step decreases step count', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /\+ add step/i }).click()
    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 2/i)).toBeVisible()

    const removeBtns = page.getByRole('button', { name: /remove/i })
    await removeBtns.first().click()
    await expect(page.getByText(/step 2/i)).not.toBeVisible()
    await expect(page.getByText(/step 1/i)).toBeVisible()
  })

  test('submit button is disabled when no steps are added', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const submitBtn = page.getByRole('button', { name: /^add$/i })
    await expect(submitBtn).toBeDisabled()
  })

  test('cancel button closes the modal', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('"Edit Stack" button opens modal pre-filled with stack data', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await expect(page).toHaveURL(/\/admin\/products\/\d+/)

    const stackItem = page.locator('[data-testid="stack-item"]').first()
    const noStacks = page.getByText(/no pipeline stacks configured/i)
    await expect(stackItem.or(noStacks)).toBeVisible({ timeout: 5000 })

    if (await noStacks.isVisible()) { test.skip(); return }

    await stackItem.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByRole('heading', { name: /edit pipeline stack/i })).toBeVisible()
    await expect(page.getByLabel(/^name$/i)).not.toBeEmpty()
  })
})

test.describe('Admin - Pipeline Stacks: full create → delete flow', () => {
  test('create a pipeline stack and verify it appears, then delete it', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/products')

    const editLinks = page.getByRole('link', { name: /edit/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    if (await noProducts.isVisible()) { test.skip(); return }

    await editLinks.first().click()
    await expect(page).toHaveURL(/\/admin\/products\/\d+/)

    // Check if an environment is configured — required for the form select
    const envSelector = page.locator('select')
    const hasEnv = await envSelector.count() > 0

    await page.getByRole('button', { name: /add stack/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    if (!hasEnv) {
      // No environment select options available — can't complete the form
      await page.getByRole('button', { name: /cancel/i }).click()
      test.skip()
      return
    }

    // Fill in the form
    await page.getByLabel(/^name$/i).fill('E2E Test Stack')
    const envSelect = page.getByLabel(/environment/i)
    const firstOption = envSelect.locator('option').nth(1)
    const optionExists = await firstOption.count() > 0
    if (!optionExists) {
      await page.getByRole('button', { name: /cancel/i }).click()
      test.skip()
      return
    }
    await envSelect.selectOption({ index: 1 })
    await page.getByLabel(/webhook url/i).fill('https://gitlab.example.com/api/v4/projects/1/trigger/pipeline')
    await page.getByLabel(/webhook token/i).fill('e2e-test-token')

    // Add a step
    await page.getByRole('button', { name: /\+ add step/i }).click()
    await expect(page.getByText(/step 1/i)).toBeVisible()
    await page.getByLabel(/template/i).fill('linode/virtual-machine')
    await page.getByLabel(/state suffix/i).fill('-vm')

    // Submit
    await page.getByRole('button', { name: /^add$/i }).click()

    // Stack should appear in the list
    await expect(page.getByText('E2E Test Stack')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/1 step/i)).toBeVisible()

    // Delete the stack
    const deleteBtn = page.locator('div').filter({ hasText: 'E2E Test Stack' }).getByRole('button', { name: /delete/i })
    await deleteBtn.click()

    // Stack should be removed
    await expect(page.getByText('E2E Test Stack')).not.toBeVisible({ timeout: 3000 })
  })
})
