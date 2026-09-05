import { test, expect } from './fixtures'
import { appears, expectNoServerError, loginAsRoot } from './helpers'

test.describe('Approvals', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRoot(page)
    await page.goto('/approvals')
  })

  test('approvals page loads without error', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/)
    await expectNoServerError(page)
  })

  test('shows page title "Approvals"', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^approvals$/i })).toBeVisible()
  })

  test('shows pending orders count in subtitle', async ({ page }) => {
    await expect(page.getByText(/orders pending approval/i)).toBeVisible()
  })

  /*
   * Three states, not two — and the third is why this test used to be wrong.
   *
   * A pending order the viewer PLACED shows no Approve button: nobody approves
   * their own order, not even root (`approvals.ts:152` refuses it with 403).
   * That guard had never actually fired in the browser, because the page
   * compares `order.userId` against `Number(session.user.id)` and NextAuth was
   * never putting the id on the session — `Number(undefined)` is NaN, which
   * equals nothing. So Approve was offered on every order, and this assertion
   * passed by describing the bug.
   *
   * With the id populated the guard works, the seeded orders belong to the
   * signed-in root, and "no empty state and no Approve button" is now the
   * correct rendering of a real state (#296).
   */
  test('shows the empty state, an approvable order, or one the viewer may not approve', async ({ page }) => {
    const noPending = page.getByText(/no pending orders/i)
    const approveBtn = page.getByRole('button', { name: /^approve$/i }).first()
    const ownOrder = page.getByText(/cannot approve your own order/i).first()
    await expect(noPending.or(approveBtn).or(ownOrder).first()).toBeVisible()
  })

  test('pending orders show Approve and Reject buttons', async ({ page }) => {
    const approveBtn = page.getByRole('button', { name: /^approve$/i }).first()
    if (await approveBtn.isVisible()) {
      await expect(page.getByRole('button', { name: /^reject$/i }).first()).toBeVisible()
    }
  })

  test('clicking Reject shows rejection note form', async ({ page }) => {
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first()
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click()
      await expect(page.getByLabel(/rejection note/i)).toBeVisible()
      await expect(page.getByPlaceholder(/explain why/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /confirm rejection/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
    }
  })

  test('cancel on rejection form hides the form', async ({ page }) => {
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first()
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click()
      await expect(page.getByRole('button', { name: /confirm rejection/i })).toBeVisible()
      await page.getByRole('button', { name: /cancel/i }).click()
      // The form is gone — which is what "cancel hides the form" means. It used
      // to assert that Approve came back instead, and that is not the same
      // claim: on an order the viewer placed there is no Approve button to
      // return to, and there never should have been (#296).
      await expect(page.getByRole('button', { name: /confirm rejection/i })).toHaveCount(0)
    }
  })

  test('approving a pending order removes it from the list', async ({ page }) => {
    const approveBtn = page.getByRole('button', { name: /^approve$/i }).first()
    /*
     * A reasoned skip and NOT `requireSeeded`, and the reason is narrower than
     * "no pending order".
     *
     * `seedDemoData` writes exactly one pending order and writes it with
     * `userId: root.id`. Nobody may approve their own order — the test above
     * says so in its own comment — so signed in as root there IS a pending
     * order on this page and there is no Approve button on it, for a reason the
     * app is right about.
     *
     * So this cannot be a `requireSeeded`: the fixture is present and the
     * absence is correct. What it must not be is silent, and the message has to
     * describe the button rather than the order, or it contradicts the page it
     * is looking at (#332).
     */
    // A short budget, not the default: this button is EXPECTED to be absent for
    // the reason above, so a full wait would add it to every run for nothing —
    // but a snapshot read would also skip on a list that simply had not painted
    // yet, which is the failure this whole PR is about.
    test.skip(
      !(await appears(approveBtn, 3_000)),
      'no order on /approvals offers Approve — the demo seeds one pending order and root placed it',
    )

    // Count pending orders before approval
    const beforeCount = await page.getByRole('button', { name: /^approve$/i }).count()
    await approveBtn.click()

    // After approval the order card should disappear (count decreases or empty state appears)
    await page.waitForTimeout(1000)
    const afterCount = await page.getByRole('button', { name: /^approve$/i }).count()
    const noOrders = page.getByText(/no pending orders/i)
    expect(afterCount < beforeCount || await noOrders.isVisible()).toBe(true)
  })

  test('rejecting a pending order with a note removes it from the list', async ({ page }) => {
    const rejectBtn = page.getByRole('button', { name: /^reject$/i }).first()
    test.skip(
      !(await appears(rejectBtn, 3_000)),
      'no order on /approvals offers Reject — see the approval test above for why the seeded one may not be',
    )

    const beforeCount = await page.getByRole('button', { name: /^reject$/i }).count()
    await rejectBtn.click()
    await page.getByLabel(/rejection note/i).fill('Rejected by e2e test')
    await page.getByRole('button', { name: /confirm rejection/i }).click()

    await page.waitForTimeout(1000)
    const afterCount = await page.getByRole('button', { name: /^reject$/i }).count()
    const noOrders = page.getByText(/no pending orders/i)
    expect(afterCount < beforeCount || await noOrders.isVisible()).toBe(true)
  })
})
