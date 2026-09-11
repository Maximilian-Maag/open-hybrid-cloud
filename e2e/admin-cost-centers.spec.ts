import { test, expect } from './fixtures'
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

  /**
   * The budget round trip (#325).
   *
   * Worth an end-to-end pass rather than leaving it to the unit tests: those
   * call the route handlers directly, so nothing else proves the four budget
   * endpoints are reachable through `/api/proxy/` at all — which is exactly the
   * class of break the deploy-config drift notes warn about, and one CI cannot
   * otherwise see.
   */
  test('can set, see and remove a cost centre budget', async ({ page }) => {
    const ts = Date.now()
    const code = `B${ts}`.slice(-8)
    const name = `E2E Budget CC ${ts}`

    await page.getByRole('button', { name: /add cost center/i }).click()
    const addDialog = page.locator('dialog[open]')
    await addDialog.getByLabel(/^code/i).fill(code)
    await addDialog.getByLabel(/^name/i).fill(name)
    await addDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 8000 })

    const row = page
      .locator('div')
      .filter({ has: page.getByText(name) })
      .filter({ has: page.getByRole('button', { name: /^budget$/i }) })
      .last()

    // --- Set ---
    await row.getByRole('button', { name: /^budget$/i }).click()
    const budgetDialog = page.locator('dialog[open]')
    // The committed figure is fetched when the modal opens, so its presence is
    // what says the GET actually came back rather than the form merely rendering.
    await expect(budgetDialog.getByText(/^committed$/i)).toBeVisible({ timeout: 8000 })
    await budgetDialog.getByLabel(/^amount/i).fill('1234')
    await budgetDialog.getByLabel(/^currency/i).fill('EUR')
    await budgetDialog.getByLabel(/^period/i).selectOption('total')
    await budgetDialog.getByLabel(/when the budget is spent/i).selectOption('block')
    await budgetDialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })

    // The badge is the round trip: it is rendered from the list endpoint, which
    // is a different request from the one that just wrote the budget.
    await expect(row.getByText(/1234\.00 EUR/)).toBeVisible({ timeout: 8000 })

    // --- Remove ---
    await row.getByRole('button', { name: /^budget$/i }).click()
    const removeDialog = page.locator('dialog[open]')
    await expect(removeDialog.getByLabel(/^amount/i)).toHaveValue('1234', { timeout: 8000 })
    await removeDialog.getByRole('button', { name: /remove budget/i }).click()
    // Asks first: this undoes a control on spending.
    await expect(removeDialog.getByText(/stop being checked against a limit/i)).toBeVisible()
    await removeDialog.getByRole('button', { name: /remove budget/i }).click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
    await expect(row.getByText(/1234\.00 EUR/)).not.toBeVisible({ timeout: 8000 })

    // --- Tidy up ---
    await row.getByRole('button', { name: /^delete$/i }).click()
    await expect(page.getByRole('heading', { name: /delete cost center/i })).toBeVisible()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
  })
})
