import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/')
  })

  test('shows welcome message with username', async ({ page }) => {
    await expect(page.getByText(/welcome back/i)).toBeVisible()
  })

  test('shows hero subtitle and Browse Catalog button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /browse catalog/i })).toBeVisible()
  })

  test('shows stats: Total Orders and Active Infrastructure', async ({ page }) => {
    await expect(page.getByText(/total orders/i)).toBeVisible()
    await expect(page.getByText(/active infrastructure/i)).toBeVisible()
  })

  test('shows Projects stat card', async ({ page }) => {
    // The stat card is a link to /projects that also contains "Manage" — unique among Projects links
    await expect(page.locator('a[href="/projects"]').filter({ hasText: /manage/i })).toBeVisible()
  })

  test('shows top navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: /^home$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^catalog$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^orders$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^projects$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^infrastructure$/i })).toBeVisible()
  })

  test('shows admin-only nav links for root user', async ({ page }) => {
    await expect(page.getByRole('link', { name: /^approvals$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^audit$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^admin$/i })).toBeVisible()
  })

  test('shows search bar in header', async ({ page }) => {
    await expect(page.getByPlaceholder(/search products/i)).toBeVisible()
  })

  test('shows My Account control', async ({ page }) => {
    await expect(page.getByText(/my account/i)).toBeVisible()
  })

  test('navigates to catalog from Browse Catalog button', async ({ page }) => {
    await page.getByRole('link', { name: /browse catalog/i }).click()
    await expect(page).toHaveURL(/\/catalog/)
  })

  test('navigates to orders from top nav', async ({ page }) => {
    await page.getByRole('link', { name: /^orders$/i }).first().click()
    await expect(page).toHaveURL(/\/orders/)
  })

  test('navigates to projects from top nav', async ({ page }) => {
    await page.getByRole('link', { name: /^projects$/i }).first().click()
    await expect(page).toHaveURL(/\/projects/)
  })

  test('header search submits and goes to catalog with query', async ({ page }) => {
    await page.getByPlaceholder(/search products/i).fill('server')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/catalog\?q=server/)
  })

  test('sign out returns to login page', async ({ page }) => {
    await page.getByText(/my account/i).click()
    await page.getByRole('button', { name: /sign out/i }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 })
  })
})
