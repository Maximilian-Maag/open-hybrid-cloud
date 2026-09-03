import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { loginAsRoot } from './helpers'

/**
 * The seam where an approved order becomes live infrastructure (#157).
 *
 * `grep -rn "webhook" e2e/` used to find form labels and a secret-rotation test
 * and nothing else: nothing in the suite ever posted to
 * `/api/webhooks/gitlab/pipeline`. The path is covered by route tests and
 * `lib/webhook/handler.test.ts`, and both of those mock `@/lib/ci` wholesale —
 * which is exactly how #121 (no order ever recorded its outputs) survived for
 * months. A test that mocks the CI client cannot see a CI client that is wrong.
 *
 * Nothing is mocked here. The trigger really goes out over HTTP, to the WireMock
 * whose stubs have been in `infra/wiremock/mappings` since #121 and which the CI
 * job never started. The callback really arrives on the public webhook route,
 * authenticated with the environment's real callback secret, and the assertions
 * are on what the portal shows afterwards.
 *
 * Skipped, loudly, where the stack is not seeded: `DEMO_CI_URL` is what points
 * the demo catalogue at something that answers, and without it the product has
 * no pipeline stack and the order would be refused before any of this. That is
 * the local default, so the reason has to name the switch.
 */

/** The product the demo seeds a pipeline stack for. */
const PROVISIONABLE = 'Managed Nginx Gateway'

/** WireMock's trigger stub answers with this id, and the callback must match it. */
const PIPELINE_ID = '42'

const backend = process.env.API_URL ?? 'http://localhost:3001'

/**
 * The callback secret of the environment the order went to.
 *
 * Read through the app's own root-only endpoint rather than out of the
 * database: it is the one the webhook route will compare against, and taking a
 * different path to it is how a test passes while the real one is broken.
 */
const callbackSecretOf = async (page: Page, environmentName: string): Promise<string> => {
  const envs = await page.request.get('/api/proxy/api/admin/environments')
  expect(envs.ok(), `listing environments failed with ${envs.status()}`).toBe(true)
  const list = (await envs.json()) as { id: number; name: string }[]
  const env = list.find((e) => e.name === environmentName)
  expect(env, `no environment called ${environmentName}`).toBeTruthy()

  const secret = await page.request.get(`/api/proxy/api/admin/environments/${env!.id}/callback-secret`)
  expect(secret.ok(), `reading the callback secret failed with ${secret.status()}`).toBe(true)
  return ((await secret.json()) as { callbackSecret: string }).callbackSecret
}

test.describe('Provisioning, end to end', () => {
  test('an order becomes infrastructure when the pipeline reports success', async ({ page }) => {
    // Two page loads, a real outbound trigger and a webhook round trip.
    test.slow()
    await loginAsRoot(page)

    await page.goto('/catalog')
    const tile = page.getByRole('link', { name: new RegExp(PROVISIONABLE, 'i') }).first()
    await tile.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
    if ((await tile.count()) === 0) {
      test.skip(true, `no ${PROVISIONABLE} in the catalogue — seed the demo data (make db-seed-demo)`)
      return
    }
    const href = await tile.getAttribute('href')
    await page.goto(href!)

    const form = page.locator('#order')
    await expect(form).toBeVisible({ timeout: 30_000 })

    /*
     * The seeded stack is bound to AWS Frankfurt, so the environment is not a
     * free choice here — the other one has no stack and the order would be
     * refused for a reason this test is not about.
     *
     * Selected by the option's VALUE, found by its text. `{ label: … }` is an
     * exact match and the option reads "AWS Frankfurt — 120.00 EUR", so naming
     * the environment alone matches nothing and Playwright spends the whole
     * timeout retrying "did not find some options" — and the price in that
     * label is a thing a future edit will change.
     */
    const envSelect = form.getByLabel(/environment/i)
    const frankfurt = await envSelect
      .locator('option', { hasText: 'AWS Frankfurt' })
      .first()
      .getAttribute('value')
    expect(frankfurt, 'the order form offers no AWS Frankfurt').toBeTruthy()
    await envSelect.selectOption(frankfurt!)
    const project = form.getByLabel(/project/i)
    if (await project.isVisible()) await project.selectOption({ index: 1 })

    // `hostname` is the stack's state key, so it has to be a real value rather
    // than the generic filler the other order test uses.
    const hostname = `e2e-gateway-${Date.now()}`
    await form.getByLabel(/hostname/i).fill(hostname)
    await form.getByLabel(/admin password/i).fill('e2e-not-a-real-password')

    await form.getByRole('button', { name: /place order/i }).click()

    const refused = page.getByText(/nothing to provision it|no pipeline configured/i).first()
    // The LIST, not the detail page: placing an order lands on /orders. Waiting
    // for `/orders/\d+` here matched nothing and reported "neither went through
    // nor said why" about an order that had gone through perfectly well.
    const redirected = page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 }).then(() => 'redirected' as const)
    const explained = refused.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'refused' as const)
    const outcome = await Promise.race([redirected, explained]).catch(() => 'neither' as const)

    if (outcome === 'refused') {
      test.skip(true, 'no pipeline stack is seeded — set DEMO_CI_URL so the demo points at a CI that answers (#157)')
      return
    }
    expect(outcome, 'the order neither went through nor said why').toBe('redirected')

    // The newest order is the one just placed. Opened by href rather than by
    // clicking, for the hydration reason the rest of the suite already documents.
    const newest = page.getByRole('link', { name: /^#\d+$/ }).first()
    await expect(newest).toBeVisible({ timeout: 30_000 })
    const orderUrl = (await newest.getAttribute('href'))!
    expect(orderUrl, 'the orders list has no link to the order just placed').toBeTruthy()
    await page.goto(orderUrl)

    /*
     * Provisioning, not completed. The trigger has gone out and nothing has
     * reported back yet, and asserting this before the callback is what makes
     * the assertion after it mean something — without it, a portal that marked
     * every order complete on submission would pass this test.
     */
    await expect(page.getByText(/provisioning/i).first()).toBeVisible({ timeout: 30_000 })

    const secret = await callbackSecretOf(page, 'AWS Frankfurt')

    // Straight at the backend, the way GitLab would: this route is public by
    // design and authenticated by the header, not by a session.
    const callback = await page.request.post(`${backend}/api/webhooks/gitlab/pipeline`, {
      headers: { 'x-gitlab-token': secret, 'content-type': 'application/json' },
      data: { object_kind: 'pipeline', object_attributes: { id: Number(PIPELINE_ID), status: 'success' } },
    })
    expect(callback.status(), await callback.text()).toBe(200)

    await page.goto(orderUrl)
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 30_000 })

    /*
     * And the element exists, carrying both the parameters the order asked for
     * and the OUTPUTS the pipeline produced.
     *
     * The outputs are the half that matters. The order reaching 'completed'
     * only says the callback was accepted; the outputs say the portal followed
     * the entry pipeline's bridges to the child pipeline, found its apply job
     * and parsed the Terraform output block out of the trace. That whole chain
     * is what #121 got wrong for months, and every test that covered it mocked
     * `@/lib/ci` — so none of them could see it.
     *
     * On the detail page, not the list: the list shows product, environment,
     * project and status, and none of those would change if the outputs never
     * arrived.
     */
    await page.goto('/infrastructure')
    const element = page.locator('main a[href^="/infrastructure/"]').first()
    await expect(element).toBeVisible({ timeout: 30_000 })
    await page.goto((await element.getAttribute('href'))!)

    await expect(page.getByText(hostname).first()).toBeVisible({ timeout: 30_000 })
    // From `gitlab-job-trace.json`, which is what the apply job's log contains.
    await expect(page.getByText('10.0.0.100').first()).toBeVisible({ timeout: 30_000 })
  })
})
