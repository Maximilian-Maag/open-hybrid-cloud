import { test, expect } from './fixtures'

// FA-15.3: The imprint text is publicly accessible at /impressum without requiring a login.
// This spec runs without the shared root session (storageState: undefined) so we can
// verify that an unauthenticated request does NOT get redirected to /login.
test.describe('Impressum (FA-15.3)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('/impressum is reachable without authentication', async ({ page }) => {
    const response = await page.goto('/impressum')
    // No redirect to /login
    expect(page.url()).toMatch(/\/impressum$/)
    // Successful response
    expect(response?.status()).toBeLessThan(400)
  })
})
