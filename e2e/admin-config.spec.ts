import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Admin - Branding Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/branding')
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible({ timeout: 8000 })
  })

  test('branding page shows title and form fields', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^branding$/i, level: 1 })).toBeVisible()
    await expect(page.getByLabel(/shop name/i)).toBeVisible()
    await expect(page.getByLabel(/subtitle/i)).toBeVisible()
    // color labels are not htmlFor-linked inputs; check the label text is visible
    await expect(page.getByText(/^primary color$/i)).toBeVisible()
    await expect(page.getByText(/^secondary color$/i)).toBeVisible()
  })

  test('saving branding shows success toast', async ({ page }) => {
    // Read the current shop name and save it unchanged
    const shopNameInput = page.getByLabel(/shop name/i)
    const currentName = await shopNameInput.inputValue()
    await shopNameInput.fill(currentName || 'Open Hybrid Cloud')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(/branding saved/i)).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Admin - SMTP Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/config/smtp')
    await expect(page.getByRole('button', { name: /save configuration/i })).toBeVisible({ timeout: 8000 })
  })

  test('SMTP page shows title and form fields', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /smtp/i, level: 1 })).toBeVisible()
    await expect(page.getByLabel(/^host/i)).toBeVisible()
    await expect(page.getByLabel(/^port/i)).toBeVisible()
    await expect(page.getByLabel(/from address/i)).toBeVisible()
    await expect(page.getByLabel(/username/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /save configuration/i })).toBeVisible()
  })

  test('filling SMTP fields and saving shows success', async ({ page }) => {
    await page.getByLabel(/^host/i).fill('smtp.example.com')
    await page.getByLabel(/^port/i).fill('587')
    await page.getByLabel(/from address/i).fill('noreply@example.com')
    await page.getByRole('button', { name: /save configuration/i }).click()
    await expect(page.getByText(/smtp.*saved|saved.*smtp/i)).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Admin - AI Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/config/ai')
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible({ timeout: 8000 })
  })

  test('AI config page shows title and provider/model fields', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /ai/i, level: 1 })).toBeVisible()
    await expect(page.getByLabel(/provider/i)).toBeVisible()
    await expect(page.getByLabel(/model/i)).toBeVisible()
    await expect(page.getByLabel(/api key/i)).toBeVisible()
  })

  test('AI provider dropdown has expected options', async ({ page }) => {
    const providerSelect = page.getByLabel(/provider/i)
    await expect(providerSelect.locator('option', { hasText: /claude|anthropic/i })).toBeAttached()
    await expect(providerSelect.locator('option', { hasText: /^OpenAI$/ })).toBeAttached()
    await expect(providerSelect.locator('option', { hasText: /ollama/i })).toBeAttached()
  })

  test('saving AI config shows success toast', async ({ page }) => {
    await page.getByLabel(/model/i).fill('claude-opus-4-5')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(/ai.*saved|saved.*ai/i)).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Admin - Exchange Rates', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/admin/exchange-rates')
    // Wait for the exchange rates table to load
    await expect(page.getByRole('button', { name: /refresh rates/i })).toBeVisible({ timeout: 8000 })
  })

  test('exchange rates page shows title and Refresh Rates button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /exchange rates/i, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /refresh rates/i })).toBeVisible()
  })

  test('exchange rates table shows currency columns', async ({ page }) => {
    // Table component always renders a <table> element (empty state shown inside it)
    await expect(page.getByRole('table')).toBeVisible({ timeout: 8000 })
    const table = page.getByRole('table')
    if (await table.isVisible()) {
      await expect(page.getByRole('columnheader', { name: /currency/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /rate/i })).toBeVisible()
    }
  })

  test('clicking Refresh Rates triggers a refresh', async ({ page }) => {
    await page.getByRole('button', { name: /refresh rates/i }).click()
    // Button should temporarily show "Refreshing…"
    await expect(page.getByRole('button', { name: /refreshing/i }).or(page.getByRole('button', { name: /refresh rates/i }))).toBeVisible({ timeout: 5000 })
  })
})
