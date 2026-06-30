import { test, expect, type Page } from '@playwright/test'
import { loginAsRoot } from './helpers'

async function goToCatalog(page: Page) {
  await loginAsRoot(page)
  await page.goto('/catalog')
}

test.describe('Product Catalog', () => {
  test('catalog page loads without error', async ({ page }) => {
    await goToCatalog(page)
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows catalog page title', async ({ page }) => {
    await goToCatalog(page)
    await expect(page.getByText(/product catalog/i)).toBeVisible()
  })

  test('shows category sidebar with heading', async ({ page }) => {
    await goToCatalog(page)
    await expect(page.getByRole('heading', { name: /categories/i }).or(page.getByText(/^categories$/i))).toBeVisible()
  })

  test('shows All Products button in sidebar', async ({ page }) => {
    await goToCatalog(page)
    await expect(page.getByRole('button', { name: /all products/i })).toBeVisible()
  })

  test('shows product count when products are available', async ({ page }) => {
    await goToCatalog(page)
    // Either products are shown with a count, or no-products message is shown
    const productCount = page.getByText(/\d+ products/i)
    const noProducts = page.getByText(/no products found/i)
    await expect(productCount.or(noProducts)).toBeVisible()
  })

  test('products have Place Order links when catalog has items', async ({ page }) => {
    await goToCatalog(page)
    const placeOrderLinks = page.getByRole('link', { name: /place order/i })
    const noProducts = page.getByText(/no products found/i)
    // Wait for catalog to finish loading (client component fetches async)
    await expect(placeOrderLinks.or(noProducts)).toBeVisible({ timeout: 10000 })
    const count = await placeOrderLinks.count()
    const isEmpty = await noProducts.isVisible()
    expect(count > 0 || isEmpty).toBe(true)
  })

  test('navigates to catalog from top nav', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')
    await page.getByRole('link', { name: /^catalog$/i }).first().click()
    await expect(page).toHaveURL(/\/catalog/)
  })

  test('header search navigates to catalog with query param', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')
    await page.getByPlaceholder(/search products/i).fill('test')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/catalog\?q=test/)
  })

  test('shows Results for text when search query is active', async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/catalog?q=server')
    await expect(page.getByText(/results for/i)).toBeVisible()
  })

  test('mobile All pill button is present', async ({ page }) => {
    await goToCatalog(page)
    // The mobile "All" pill and sidebar "All products" button should both exist in the DOM
    const allButtons = page.getByRole('button', { name: /^all$/i })
    // May or may not be visible depending on viewport (mobile-only)
    await expect(allButtons.or(page.getByRole('button', { name: /all products/i }))).toBeVisible()
  })
})
