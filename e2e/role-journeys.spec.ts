import { test, expect } from './fixtures'
import { type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  createAccount,
  hydrated,
  requireSeeded,
  rootStorageStateFile,
  signInAsAccount,
  signOutViaMenu,
  type TestAccount,
  type TestRole,
} from './helpers'

/**
 * What each role is RESPONSIBLE for, played end to end as that role (#363).
 *
 * ── The table this file is the executable half of ───────────────────────────
 *
 *   Project manager  places orders for their own projects; manages those
 *                    projects; sees their own orders and infrastructure;
 *                    approves nothing, including their own order.
 *   Admin            approves or rejects orders; orders directly, without an
 *                    approval; sees every order and every element.
 *   Root             the catalogue, environments, CI sources, users, cost
 *                    centres, branding and config; deployment windows and the
 *                    deploy-now override; everything an admin can do.
 *
 * `roles.spec.ts` says what each role may REACH — a permission matrix, one
 * request per cell. This says what each role is FOR, which is a different
 * question: an endpoint can be reachable and the journey through it still
 * broken at the handover.
 *
 * ── Why the sign-outs are in the test ───────────────────────────────────────
 * `processes.spec.ts` plays both parties at once, in two browser contexts, and
 * that is the right shape for asserting what must NOT happen — an orderer
 * approving themselves, an order skipping the queue. It is the wrong shape for
 * the ordinary path, because two people signed in simultaneously in one browser
 * is not what happens: the project manager goes home, the admin comes in the
 * next morning.
 *
 * So each handover here is a real sign-out and a real sign-in. That also makes
 * the test sensitive to a class of bug the parallel-context version cannot see —
 * a session that does not survive the round trip, or one that does not end. #359
 * was exactly that, and every process test stayed green through it.
 *
 * ── Setup by API, decision by UI ────────────────────────────────────────────
 * Same convention as `processes.spec.ts`: the legs that merely have to happen
 * (the project, the cart line) go through the API and have their own coverage
 * elsewhere. The leg under test — seeing the order in the queue and acting on
 * it — is driven through the screen, because that is the claim.
 */

interface Session {
  account: TestAccount
  page: Page
  context: BrowserContext
}

async function asRoot(browser: Browser): Promise<{ request: APIRequestContext; context: BrowserContext }> {
  const context = await browser.newContext({ storageState: rootStorageStateFile })
  return { request: context.request, context }
}

/** An account of `role`, created by root and then signed in as itself. */
async function actor(browser: Browser, role: TestRole): Promise<Session> {
  const root = await asRoot(browser)
  let account: TestAccount
  try {
    account = await createAccount(await root.context.newPage(), role)
  } finally {
    await root.context.close()
  }
  const { page, context } = await signInAsAccount(browser, account)
  return { account, page, context }
}

/** Sign in again as the same account, in a context of its own. */
async function signBackIn(browser: Browser, account: TestAccount): Promise<Session> {
  const { page, context } = await signInAsAccount(browser, account)
  return { account, page, context }
}

interface Offering {
  productId: number
  environmentId: number
  sizeCode: string | null
}

/** Every (product, environment) the catalogue offers this caller. */
async function offeringsFor(request: APIRequestContext): Promise<Offering[]> {
  const listRes = await request.get('/api/proxy/api/catalog?lang=en&limit=25')
  expect(listRes.ok(), `the catalogue would not load: ${listRes.status()}`).toBe(true)
  const { items = [] } = (await listRes.json()) as { items?: { id: number }[] }

  const offerings: Offering[] = []
  for (const item of items) {
    const detailRes = await request.get(`/api/proxy/api/catalog/${item.id}?lang=en`)
    if (!detailRes.ok()) continue
    const detail = (await detailRes.json()) as {
      environments?: { environmentId: number; sizes?: { code: string }[] }[]
    }
    for (const env of detail.environments ?? []) {
      offerings.push({
        productId: item.id,
        environmentId: env.environmentId,
        sizeCode: env.sizes?.[0]?.code ?? null,
      })
    }
  }
  return offerings
}

interface ParameterDef {
  name: string
  type: string
  required: boolean
  defaultValue: string
}

/**
 * The product's parameters, as the ORDER SERVICE will validate them.
 *
 * From the catalogue detail WITH `environmentId`, not from a parameters
 * endpoint: the detail route collapses same-name definitions across scopes only
 * once an environment is known, and that collapsed set is the one checkout
 * checks against. Asking any other way answers the wrong form — the first
 * version of this asked a path that does not exist, got nothing, and every
 * checkout came back "Missing required parameter: hostname".
 */
async function parametersFor(request: APIRequestContext, offering: Offering): Promise<ParameterDef[]> {
  const res = await request.get(
    `/api/proxy/api/catalog/${offering.productId}?lang=en&environmentId=${offering.environmentId}`,
  )
  if (!res.ok()) return []
  return ((await res.json()) as { parameters?: ParameterDef[] }).parameters ?? []
}

/** Fill in whatever the offering asks for, plausibly enough to pass validation. */
const answerParameters = (defs: ParameterDef[], label: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const def of defs) {
    if (!def.required || def.type === 'size') continue
    if (def.defaultValue && def.type !== 'dropdown') {
      values[def.name] = def.defaultValue
      continue
    }
    switch (def.type) {
      case 'dropdown': {
        // Options are the default value, comma-separated — the same split the
        // order form does to build its <select>.
        const first = def.defaultValue.split(',').map((v) => v.trim()).filter(Boolean)[0]
        if (first) values[def.name] = first
        break
      }
      case 'number': values[def.name] = '1'; break
      case 'bool': values[def.name] = 'false'; break
      default:
        // Hostname-shaped: lowercase, no spaces, unique, short enough for a
        // length rule.
        values[def.name] = `e2e-${label}-${Date.now().toString(36)}`.slice(0, 40)
    }
  }
  return values
}

/**
 * Place an order as this session, returning its id.
 *
 * Each offering is tried until checkout accepts one: a refusal for want of a
 * pipeline is about that product in that environment, not about the catalogue.
 */
async function placeOrder(session: Session, label: string): Promise<number> {
  const { request } = session.page
  const projectRes = await request.post('/api/proxy/api/projects', {
    data: { name: `E2E ${label} ${Date.now()}`, description: 'role-journeys.spec.ts' },
  })
  expect(projectRes.ok(), `could not create a project: ${projectRes.status()}`).toBe(true)
  const project = (await projectRes.json()) as { id: number }

  const refusals: string[] = []
  for (const offering of await offeringsFor(request)) {
    const cartRes = await request.post('/api/proxy/api/cart', {
      data: {
        productId: offering.productId,
        environmentId: offering.environmentId,
        ...(offering.sizeCode !== null ? { sizeCode: offering.sizeCode } : {}),
        quantity: 1,
      },
    })
    if (!cartRes.ok()) { refusals.push(`cart ${cartRes.status()}`); continue }
    const cartItem = (await cartRes.json()) as { id: number }

    const checkoutRes = await request.post('/api/proxy/api/cart/checkout', {
      data: {
        projectId: project.id,
        items: [{
          cartItemId: cartItem.id,
          parameters: answerParameters(await parametersFor(request, offering), label),
        }],
      },
    })
    if (checkoutRes.ok()) {
      const created = (await checkoutRes.json()) as { orderIds?: number[]; id?: number }
      const orderId = created.orderIds?.[0] ?? created.id
      expect(orderId, `checkout returned no order id: ${JSON.stringify(created)}`).toBeTruthy()
      return orderId as number
    }
    refusals.push(`checkout ${checkoutRes.status()}: ${(await checkoutRes.text()).slice(0, 120)}`)
  }
  throw new Error(`no offering could be ordered. Refusals: ${refusals.join(' | ')}`)
}

/** What the order detail page says the status is, read as this session. */
async function statusOf(session: Session, orderId: number): Promise<string> {
  const res = await session.page.request.get(`/api/proxy/api/orders/${orderId}`)
  expect(res.ok(), `could not read order ${orderId}: ${res.status()}`).toBe(true)
  return ((await res.json()) as { status: string }).status
}

test.describe('the journey each role is responsible for', () => {
  // Three real sign-ins, two of them with a second factor, plus a checkout.
  test.describe.configure({ timeout: 300_000 })

  test.beforeEach(async ({ browser }) => {
    // The catalogue has to have something orderable in it, which is the demo
    // seed's job. Skipping loudly beats a checkout failure that reads as a bug.
    const root = await asRoot(browser)
    try {
      const res = await root.request.get('/api/proxy/api/catalog?lang=en&limit=1')
      const { items = [] } = res.ok() ? ((await res.json()) as { items?: unknown[] }) : {}
      requireSeeded(items.length > 0, 'the catalogue is empty — run the demo seed')
    } finally {
      await root.context.close()
    }
  })

  /**
   * The headline journey, and the one the platform exists for.
   *
   * A project manager asks, goes home, an admin decides the next morning, and
   * the project manager sees the answer. Three sessions, two sign-outs, one
   * order.
   */
  test('a project manager orders, signs out, an admin approves, and the orderer sees it', async ({ browser }) => {
    const pm = await actor(browser, 'project_manager')
    let orderId: number
    try {
      orderId = await placeOrder(pm, 'pm-journey')

      // As the orderer: it is waiting for somebody else, and there is nothing
      // here for them to press.
      await pm.page.goto(`/orders/${orderId}`)
      await hydrated(pm.page)
      await expect(pm.page.getByTestId('order-status')).toHaveText(/pending/i)

      /*
       * No detour to /approvals to check the button is absent.
       *
       * The role guard bounces a project manager off that page, and the
       * redirect races the sign-out click that follows — which is a flake, not
       * a finding. That a project manager cannot approve is asserted twice
       * already, in `roles.spec.ts`'s permission matrix and in
       * `processes.spec.ts`'s "the orderer cannot approve their own order".
       * This test is about the handover, so it signs out from where it is.
       */
      await signOutViaMenu(pm.page)
    } finally {
      await pm.context.close()
    }

    // ── The next morning ────────────────────────────────────────────────────
    const admin = await actor(browser, 'admin')
    try {
      await admin.page.goto('/approvals')
      await hydrated(admin.page)

      // The order is in the queue, and the admin approves it from there —
      // through the screen, because "the approver SEES it" is the claim.
      /*
       * THIS order's row, not the first Approve button on the page.
       *
       * The queue holds other people's orders, so a journey that clicks
       * whichever button comes first can approve somebody else's and still go
       * green — while the order under test sits in `pending` and the assertion
       * below fails somewhere confusing. `data-order-id` exists for this.
       */
      const row = admin.page.locator(`[data-order-id="${orderId}"]`)
      await expect(row, 'the order never reached the approval queue').toBeVisible({ timeout: 30_000 })
      await row.getByRole('button', { name: /^approve$/i }).click()

      // It leaves `pending` — where it goes next depends on whether CI answers,
      // which is provisioning.spec.ts's subject rather than this one's.
      await expect
        .poll(async () => statusOf(admin, orderId), { timeout: 60_000 })
        .not.toBe('pending')

      await signOutViaMenu(admin.page)
    } finally {
      await admin.context.close()
    }

    // ── Back as the orderer ─────────────────────────────────────────────────
    const pmAgain = await signBackIn(browser, pm.account)
    try {
      expect(
        await statusOf(pmAgain, orderId),
        'the orderer signed back in and still saw their order as pending',
      ).not.toBe('pending')

      /*
       * The status BADGE, not the word. "Pending" appears twice on this page
       * with different meanings — the order's status, and the placeholder for a
       * pipeline that has not reported — and the first version of this
       * assertion read the second one and failed on a journey that had worked.
       */
      await pmAgain.page.goto(`/orders/${orderId}`)
      await hydrated(pmAgain.page)
      await expect(pmAgain.page.getByTestId('order-status')).not.toHaveText(/pending/i)
    } finally {
      await pmAgain.context.close()
    }
  })

  /**
   * An admin's own responsibility: ordering without asking anybody.
   *
   * The same catalogue and the same checkout, and the order does NOT stop in
   * the queue — that is the whole difference between the two roles, and it is
   * worth an assertion rather than an assumption.
   */
  test('an admin orders directly, and it never waits for an approval', async ({ browser }) => {
    const admin = await actor(browser, 'admin')
    try {
      const orderId = await placeOrder(admin, 'admin-direct')

      expect(
        await statusOf(admin, orderId),
        "an admin's own order stopped in the approval queue",
      ).not.toBe('pending')

      await admin.page.goto('/approvals')
      await hydrated(admin.page)
      await expect(admin.page.locator(`[data-order-id="${orderId}"]`)).toHaveCount(0)
    } finally {
      await admin.context.close()
    }
  })
})
