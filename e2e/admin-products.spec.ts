import { test, expect } from './fixtures'
import { appears, loginAsRoot, requireSeeded } from './helpers'

test.describe('Admin - Product Delete Button', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/products')
    await expect(page.getByRole('heading', { name: /^products$/i, level: 1 })).toBeVisible({ timeout: 8000 })
  })

  test('list row shows both Edit and Delete buttons', async ({ page }) => {
    // `^edit\b`, not `^edit$`: the row's Edit link carries the product name in an
    // sr-only span, so that a screen reader's link list is not "Edit, Edit, Edit"
    // against three different hrefs (WCAG 2.4.9). Its accessible name is therefore
    // "Edit <product>", and an anchored pattern matches nothing.
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    // At least one row exposes a Delete button next to the Edit link
    // Anchored on a word boundary, not on the end: the row's Delete carries the
    // product name in an sr-only span, exactly as the Edit link above does.
    await expect(page.getByRole('button', { name: /^delete\b/i }).first()).toBeVisible()
  })

  test('clicking Delete opens confirmation modal warning about cascade decommission', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    await page.getByRole('button', { name: /^delete\b/i }).first().click()

    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: /delete product/i })).toBeVisible()
    // Warning surface: cascade decommission is called out so the Root user knows the blast radius
    await expect(dialog.getByText(/decommissioned/i)).toBeVisible()
    await expect(dialog.getByText(/destroy webhook/i)).toBeVisible()
  })

  test('Cancel closes the modal without deleting', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    const productCountBefore = await page.getByRole('button', { name: /^delete\b/i }).count()

    await page.getByRole('button', { name: /^delete\b/i }).first().click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).not.toBeVisible()

    // Row count unchanged
    await expect(page.getByRole('button', { name: /^delete\b/i })).toHaveCount(productCountBefore)
  })

  // Happy path: create a throw-away product, delete via UI, verify it's gone.
  // Requires at least one category to exist (bootstrap seeds none, so create
  // one via the admin UI first).
  test('creates a product, deletes it via the confirmation dialog, and verifies it is removed', async ({ page }) => {
    const ts = Date.now()
    const productName = `E2E Delete ${ts}`
    const categoryName = `E2E Cat ${ts}`

    // Seed a category so the New Product form has something to select
    await page.goto('/admin/categories')
    await expect(page.getByRole('button', { name: /add category/i })).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /add category/i }).click()
    let dialog = page.locator('dialog[open]')
    await dialog.getByLabel(/^name/i).fill(categoryName)
    await dialog.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByText(categoryName)).toBeVisible({ timeout: 8000 })

    // Create the product
    await page.goto('/admin/products/new')
    await page.getByLabel(/^name/i).fill(productName)
    await page.getByLabel(/^description/i).fill('created solely to be deleted')
    await page.getByLabel(/category/i).selectOption({ label: categoryName })
    await page.getByRole('button', { name: /save|create/i }).click()

    // After create the form redirects to the edit page — go back to the list
    await page.goto('/admin/products')
    // exact, because the name cell and the row's Edit link ("Edit <product>") both
    // contain the product name and a substring match resolves to both.
    await expect(page.getByRole('link', { name: productName, exact: true })).toBeVisible({ timeout: 8000 })

    // Confirm-delete the product
    const productRow = page.locator('tr').filter({ has: page.getByRole('link', { name: productName, exact: true }) })
    // `\b`, not `$`: every row action carries the product name in an sr-only
    // span, because a screen reader's list of controls is otherwise "Delete,
    // Delete, Delete" with nothing to tell the rows apart. The Edit link above
    // is matched the same way for the same reason.
    await productRow.getByRole('button', { name: /^delete\b/i }).click()

    dialog = page.locator('dialog[open]')
    await expect(dialog.getByRole('heading', { name: /delete product/i })).toBeVisible()
    // Cascade-decommission warning is present (tested elsewhere) — proceed with confirm
    await dialog.getByRole('button', { name: /^delete$/i }).click()

    // 30s, not 8. The delete goes through `router.refresh()`, which re-renders
    // the list on the SERVER — and against `next dev` that is a recompile the
    // first time in a run. The row does go (the product is gone from the
    // database when this fails), so the eight seconds were measuring the dev
    // server rather than the deletion (#296).
    await expect(page.getByRole('link', { name: productName, exact: true })).not.toBeVisible({ timeout: 30_000 })

    // Cleanup: remove the category we seeded
    await page.goto('/admin/categories')
    const catRow = page.locator('div').filter({ has: page.getByText(categoryName) }).filter({ has: page.getByRole('button', { name: /^delete$/i }) }).last()
    await catRow.getByRole('button', { name: /^delete$/i }).click()
    await page.getByRole('button', { name: /^delete$/i }).last().click()
    await expect(page.locator('dialog[open]')).not.toBeVisible({ timeout: 8000 })
  })
})

test.describe('Admin - Product Environment Removal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  // The Remove button only appears for environments the product is actually
  // linked to, so this needs a product with a saved offering. Skips cleanly on a
  // stack with no products or no deployment environments configured.
  test('Remove asks for confirmation and explains what is discarded', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    // By href: a Next.js `<Link>` is inert until React hydrates, and `next dev`
    // compiles this route on its first request (#296).
    const href = await editLinks.first().getAttribute('href')
    expect(href, 'the product list has an Edit link with no href').toBeTruthy()
    await page.goto(href as string)

    /*
     * `/environments$/i`, not `/^environments$/i`. The card is titled
     * "Deployment Environments" — it was renamed while this test was skipping
     * for want of a product, and an anchored match then found nothing (#296).
     *
     * Located from the heading upwards rather than by filtering every `div`:
     * `locator('div').filter(...)` matches the card AND each of its ancestors,
     * so `.last()` is a guess about document order rather than a statement
     * about which box is the card.
     */
    const envHeading = page.getByRole('heading', { name: /environments$/i }).first()
    await expect(envHeading).toBeVisible({ timeout: 30_000 })

    /*
     * The comment above was right that `.last()` is a guess, and the guess was
     * wrong: every ancestor of the section heading matches, and the innermost is
     * the heading's own wrapper, which holds no buttons at all. So this found
     * nothing and skipped — every run, for months, in silence (#332).
     *
     * Each offering renders its own card: a level-3 heading naming the
     * environment, and that offering's Remove. Asking for the innermost box that
     * holds BOTH is a statement about which box is the card rather than a bet on
     * document order.
     */
    const offeringCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { level: 3 }) })
      .filter({ has: page.getByRole('button', { name: /^remove$/i }) })
      .last()

    const remove = offeringCard.getByRole('button', { name: /^remove$/i }).first()
    requireSeeded(await appears(remove), 'the product offers no environment binding to remove')

    await remove.click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: /^remove .+\?$/i })).toBeVisible()
    // Blast radius is spelled out: the offering goes, provisioned infra does not.
    await expect(dialog.getByText(/no longer be orderable/i)).toBeVisible()

    // Cancel leaves the offering in place.
    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).not.toBeVisible()
    await expect(offeringCard.getByRole('button', { name: /^remove$/i }).first()).toBeVisible()
  })
})

test.describe('Admin - Trial Offerings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
  })

  // Issue #1. Trials are opt-in per offering, so the duration field is gated on
  // the checkbox rather than always present.
  test('the trial duration appears only once the offering is opted in', async ({ page }) => {
    await page.goto('/admin/products')
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    await editLinks.first().click()
    const trialToggle = page.getByLabel(/offer as trial/i).first()
    // The toggle is rendered per environment offering, so it only exists once
    // the edit page's offerings have. Counted immediately after the click, it
    // was always 0 and this test always skipped.
    requireSeeded(await appears(trialToggle), 'the product edit page offers no trial toggle')

    await expect(page.getByLabel(/trial duration/i)).toHaveCount(0)
    await trialToggle.check()
    await expect(page.getByLabel(/trial duration/i).first()).toBeVisible()
    // 30 minutes is the issue's number, carried as the default.
    await expect(page.getByLabel(/trial duration/i).first()).toHaveValue('30')

    // Leave the offering as it was.
    await trialToggle.uncheck()
  })
})

// Issue #38. History rows appear as a side effect of edits, so what is asserted
// here is that the panel exists and the changelog field feeds it.
test.describe('Admin - Product Version History', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/products')
  })

  test('the product edit page carries a version history panel', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    await editLinks.first().click()
    await expect(page.getByRole('heading', { name: /version history/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel(/^changelog$/i)).toBeVisible()
  })

  test('saving with a changelog note adds it to the history', async ({ page }) => {
    const editLinks = page.getByRole('link', { name: /^edit\b/i })
    const noProducts = page.getByText(/no products/i)
    await expect(editLinks.or(noProducts).first()).toBeVisible({ timeout: 10000 })
    requireSeeded(!(await noProducts.isVisible()), 'no product on /admin/products to edit')

    await editLinks.first().click()
    await expect(page.getByLabel(/^changelog$/i)).toBeVisible({ timeout: 10000 })

    const note = `e2e changelog ${Date.now()}`
    await page.getByLabel(/^changelog$/i).fill(note)
    // The first Save button belongs to the basic-info form.
    await page.getByRole('button', { name: /^save$/i }).first().click()

    await expect(page.getByText(note)).toBeVisible({ timeout: 10000 })
    // Cleared after saving, since a note describes one change.
    await expect(page.getByLabel(/^changelog$/i)).toHaveValue('')
  })
})
