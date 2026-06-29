import { test, expect } from '@playwright/test'
import { loginAsRoot } from './helpers'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/settings')
  })

  test('settings page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('shows Profile section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^profile$/i })).toBeVisible()
  })

  test('shows Email field that is disabled', async ({ page }) => {
    const emailInput = page.getByLabel(/^email$/i)
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toBeDisabled()
  })

  test('shows Name field that is editable', async ({ page }) => {
    const nameInput = page.getByLabel(/^name/i).first()
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toBeEnabled()
  })

  test('shows Save Profile button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save profile/i })).toBeVisible()
  })

  test('shows Change Password section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /change password/i })).toBeVisible()
  })

  test('shows Current Password field', async ({ page }) => {
    await expect(page.getByLabel(/current password/i)).toBeVisible()
  })

  test('shows New Password field', async ({ page }) => {
    await expect(page.getByLabel(/^new password/i)).toBeVisible()
  })

  test('shows Confirm New Password field', async ({ page }) => {
    await expect(page.getByLabel(/confirm new password/i)).toBeVisible()
  })

  test('shows Change Password button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^change password$/i })).toBeVisible()
  })

  test('mismatched passwords show error message', async ({ page }) => {
    await page.getByLabel(/current password/i).fill('currentpass')
    await page.getByLabel(/^new password/i).fill('newpassword1')
    await page.getByLabel(/confirm new password/i).fill('differentpassword')
    await page.getByRole('button', { name: /^change password$/i }).click()
    await expect(page.getByText(/passwords do not match/i)).toBeVisible()
  })

  test('updating profile name shows success message', async ({ page }) => {
    const nameInput = page.getByLabel(/^name/i).first()
    const currentName = await nameInput.inputValue()
    // Update to same name to avoid actually changing it
    await nameInput.fill(currentName || 'Test User')
    await page.getByRole('button', { name: /save profile/i }).click()
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 10000 })
  })

  test('wrong current password shows an error on password change', async ({ page }) => {
    await page.getByLabel(/current password/i).fill('wrongpassword')
    await page.getByLabel(/^new password/i).fill('NewPassword123!')
    await page.getByLabel(/confirm new password/i).fill('NewPassword123!')
    await page.getByRole('button', { name: /^change password$/i }).click()
    // The backend rejects a wrong current password — some error message appears
    await expect(
      page.getByText(/invalid|incorrect|wrong|unauthorized|failed/i)
    ).toBeVisible({ timeout: 8000 })
  })
})
