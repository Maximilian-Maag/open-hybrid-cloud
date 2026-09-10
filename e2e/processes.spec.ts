import { test, expect } from './fixtures'
import { type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  createAccount,
  hydrated,
  rootStorageStateFile,
  signInAsAccount,
  type TestAccount,
} from './helpers'

/**
 * The processes this platform exists to run, each played by the roles that run it.
 *
 * ── What makes these different from the other specs ─────────────────────────
 * Every other spec asserts a screen: this page has that heading, that button
 * opens that dialog. They are all played by root, and each one starts and ends
 * on one page.
 *
 * A process crosses accounts. "A project manager orders something and an admin
 * approves it" cannot be tested by one session, because the whole point is that
 * the person who asks is not the person who decides — and the interesting
 * failures live exactly at that handover. An order that a project manager can
 * approve themselves, an order that never reaches the queue, a rejection whose
 * note the orderer never sees: none of those can be seen from a single session,
 * and none of them were covered.
 *
 * ── Setup by API, decision by UI ────────────────────────────────────────────
 * The legs that merely have to HAPPEN go through the API — creating the account,
 * the project, the cart line. They have their own coverage in the specs named
 * after them, and driving them through the UI here would make each of these
 * tests a re-test of the order form plus a minute of wall clock.
 *
 * The leg under test is driven through the UI, because that is the claim: the
 * approver SEES the order in their queue, and acts on it from there.
 *
 * ── What is not here yet ────────────────────────────────────────────────────
 * The half of the order process that runs after approval — CI triggered, a
 * webhook callback, an infrastructure element going active. Approving fires a
 * real pipeline trigger, so it needs a CI endpoint the suite can answer for;
 * that is #157's subject, and `provisioning.spec.ts` is where it lands. Until
 * then these tests stop at the approval decision and its effect on the order,
 * which is the part that needs no pipeline. `rejectOrder` triggers nothing, so
 * the rejection path is complete here.
 */

/** A signed-in account, and the context to close when the test is done. */
interface Session {
  account: TestAccount
  page: Page
  context: BrowserContext
}

/** Root's own request context — for the fixtures only root may create. */
async function asRoot(browser: Browser): Promise<{ request: APIRequestContext; context: BrowserContext }> {
  const context = await browser.newContext({ storageState: rootStorageStateFile })
  return { request: context.request, context }
}

/**
 * An account of `role`, signed in, ready to act.
 *
 * Creating the account needs root; being the account needs a context that is
 * NOT root's. Hence the two contexts — and the root one is closed as soon as it
 * has done its job.
 */
async function actor(browser: Browser, role: 'project_manager' | 'admin'): Promise<Session> {
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

interface Offering {
  productId: number
  environmentId: number
  sizeCode: string | null
}

/**
 * Every (product, environment) pair the catalogue offers this caller.
 *
 * All of them, not the first — because "has an environment offering" is not the
 * same as "can be ordered". An order also needs the product to have something to
 * provision it in THAT environment (a pipeline stack or a webhook), and nothing
 * in the catalogue response says which environments have one. So the list is
 * candidates, and `placeOrder` finds out which of them checkout will accept.
 *
 * Picking `environments[0]` and hoping was the first version of this, and it is
 * a coin toss: the demo seed gives a product two environments and a stack to one
 * of them.
 */
async function findOrderableOfferings(request: APIRequestContext): Promise<Offering[]> {
  const listRes = await request.get('/api/proxy/api/catalog?lang=en&limit=25')
  if (!listRes.ok()) throw new Error(`the catalogue would not load: ${listRes.status()}`)
  const { items = [] } = (await listRes.json()) as { items?: Array<{ id: number }> }

  const offerings: Offering[] = []
  for (const item of items) {
    const detailRes = await request.get(`/api/proxy/api/catalog/${item.id}?lang=en`)
    if (!detailRes.ok()) continue
    const detail = (await detailRes.json()) as {
      environments?: Array<{ environmentId: number; sizes?: Array<{ code: string }> }>
    }
    for (const env of detail.environments ?? []) {
      offerings.push({
        productId: item.id,
        environmentId: env.environmentId,
        // An offering with sizes prices per size and the order must name one; one
        // without keeps its own price and must NOT name one (#98).
        sizeCode: env.sizes?.[0]?.code ?? null,
      })
    }
  }
  return offerings
}

/**
 * One parameter definition, as the catalogue detail endpoint resolves it.
 *
 * A trimmed copy of `Parameter` — `e2e/` is not in either app's module graph, and
 * only these five fields are needed to answer the form.
 */
interface ParameterDef {
  name: string
  type: 'string' | 'number' | 'bool' | 'dropdown' | 'size'
  defaultValue: string
  required: boolean
  sensitive: boolean
}

/**
 * Values for the parameters an order must carry.
 *
 * `createOrder` validates required parameters and refuses the order without them
 * — "Missing required parameter: hostname" is what the first version of this got
 * for sending `{}`. Filling them is not incidental to these tests: an order that
 * cannot be placed cannot be approved, and the approval handover is the subject.
 *
 * The default is used where there is one, because that is what the form would
 * submit if the user touched nothing. Where there is not — a `sensitive`
 * parameter has its default stripped on the way out (#131) — a value is invented
 * per type. Nothing is provisioned from these: every order here is rejected or
 * left pending, so the values only have to be ACCEPTED, not meaningful.
 *
 * `size` is skipped on purpose: it is driven by the chosen size code rather than
 * typed into the form, and `sizeValues` maps it per variable.
 */
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
      case 'number':
        values[def.name] = '1'
        break
      case 'bool':
        values[def.name] = 'false'
        break
      default:
        // A hostname-shaped string: lowercase, no spaces, unique per order, and
        // short enough not to trip a length rule.
        values[def.name] = `e2e-${label}-${Date.now().toString(36)}`.slice(0, 40)
    }
  }
  return values
}

/** The parameters this offering asks for, resolved for the chosen environment. */
async function parametersFor(
  request: APIRequestContext,
  offering: Offering,
): Promise<ParameterDef[]> {
  // WITH `environmentId`: the endpoint collapses same-name definitions across
  // scopes only once an environment is known, and that collapsed set is exactly
  // what the order service will validate against. Asking without it returns one
  // candidate per environment and would answer the wrong form.
  const res = await request.get(
    `/api/proxy/api/catalog/${offering.productId}?lang=en&environmentId=${offering.environmentId}`,
  )
  if (!res.ok()) return []
  const detail = (await res.json()) as { parameters?: ParameterDef[] }
  return detail.parameters ?? []
}

/**
 * What checkout says when the product cannot be provisioned at all.
 *
 * Matched on, and it is worth explaining why rather than treating it as an
 * ordinary refusal. `seedDemoData` creates a CI source and two deployment
 * environments but NO pipeline stack, so no seeded product has anything to
 * provision it and checkout refuses every order with this message. That is the
 * one cause behind seven of the eight entries in CI's skip budget, and #157 is
 * what fixes it by seeding a stack and standing up a CI endpoint the suite can
 * answer for.
 *
 * Until that lands, these tests cannot place an order on this data — and a test
 * that cannot run should say so, loudly, rather than fail as though the approval
 * process were broken. Once it lands they start passing with no change here,
 * which is the property that makes matching on the message worth the fragility:
 * the alternative is a hardcoded skip that outlives its reason.
 */
const NOTHING_TO_PROVISION = /no pipeline configured|nothing to provision it/i

/**
 * Place an order as this account, and return its id — or null if this catalogue
 * cannot be ordered from at all.
 *
 * A project of its own each time, because `listProjects` scopes a project
 * manager to `ownerId = self`: a fresh account sees none of the seeded ones, so
 * "use the first project" would work as root and fail as the role this is
 * actually about. Creating one is `requireAuth`, so the orderer can do it.
 */
async function placeOrder(
  session: Session,
  offerings: Offering[],
  label: string,
): Promise<number | null> {
  const { request } = session.page

  const projectRes = await request.post('/api/proxy/api/projects', {
    data: { name: `E2E ${label} project ${Date.now()}`, description: 'Created by processes.spec.ts' },
  })
  expect(projectRes.ok(), `could not create a project: ${projectRes.status()} ${await projectRes.text()}`).toBe(true)
  const project = (await projectRes.json()) as { id: number }

  // Try each offering until checkout accepts one. A refusal for want of a
  // pipeline is about THAT product in THAT environment, not about the catalogue,
  // so it is worth trying the next before giving up.
  const refusals: string[] = []
  for (const offering of offerings) {
    const cartRes = await request.post('/api/proxy/api/cart', {
      data: {
        productId: offering.productId,
        environmentId: offering.environmentId,
        ...(offering.sizeCode !== null ? { sizeCode: offering.sizeCode } : {}),
        quantity: 1,
      },
    })
    expect(cartRes.ok(), `could not add to the cart: ${cartRes.status()} ${await cartRes.text()}`).toBe(true)
    const cartItem = (await cartRes.json()) as { id: number }

    const parameters = answerParameters(await parametersFor(request, offering), label)
    const checkoutRes = await request.post('/api/proxy/api/cart/checkout', {
      data: {
        projectId: project.id,
        items: [{ cartItemId: cartItem.id, parameters }],
      },
    })

    if (checkoutRes.ok()) {
      // Checkout answers with what it created. One cart line, one order.
      const created = (await checkoutRes.json()) as { orderIds?: number[]; id?: number }
      const orderId = created.orderIds?.[0] ?? created.id
      expect(orderId, `checkout returned no order id: ${JSON.stringify(created)}`).toBeTruthy()
      return orderId as number
    }

    const refusal = await checkoutRes.text()
    refusals.push(`product ${offering.productId} / env ${offering.environmentId}: ${refusal}`)
    // Anything OTHER than "nothing can provision this" is a real failure and
    // should not be hidden by trying the next candidate.
    if (!NOTHING_TO_PROVISION.test(refusal)) {
      expect(false, `checkout refused the order: ${checkoutRes.status()} ${refusal}`).toBe(true)
    }
    // Leave nothing behind for the next attempt to check out alongside.
    await request.delete(`/api/proxy/api/cart/${cartItem.id}`)
  }

  // Every candidate refused for want of something to provision it. The caller
  // skips, and the reasons are worth printing: they are the diagnosis.
  console.log(`[${label}] nothing orderable in this catalogue:\n  ${refusals.join('\n  ')}`)
  return null
}

/** One order, as the API reports it to this session. */
async function readOrder(session: Session, orderId: number) {
  const res = await session.page.request.get(`/api/proxy/api/orders/${orderId}`)
  return { status: res.status(), body: res.ok() ? await res.json() : null }
}

test.describe.serial('Process: a project manager orders and an admin decides', () => {
  // Two administrative sign-ins, each with a mandatory second-factor enrolment
  // (#197), plus a cold `next dev` compile of every route these touch.
  test.setTimeout(300_000)

  let pm: Session
  let admin: Session
  let offerings: Offering[]

  test.beforeAll(async ({ browser }) => {
    // The HOOK's own timeout — a describe-level `test.setTimeout` sets the
    // TESTS', and `beforeAll` keeps the 30-second default. Two sign-ins, one of
    // them an admin paying the mandatory enrolment (#197), do not fit in that.
    // And it does not fail as a timeout: Playwright disposes the contexts when it
    // kills the hook, so the request in flight rejects first and the run blames
    // `Request context disposed` on whatever was being set up.
    test.setTimeout(300_000)

    pm = await actor(browser, 'project_manager')
    admin = await actor(browser, 'admin')
    // Discovered from the PROJECT MANAGER's session, because it is the shop as
    // the customer sees it — and because an offering root can see but a customer
    // cannot is a bug this should surface rather than route around.
    offerings = await findOrderableOfferings(pm.page.request)
  })

  test.afterAll(async () => {
    await pm?.context.close()
    await admin?.context.close()
  })

  test('the order a project manager places waits for a decision rather than provisioning itself', async () => {
    test.skip(offerings.length === 0, 'the catalogue has no product with an environment offering — seed the demo catalogue')
    const orderId = await placeOrder(pm, offerings, 'pending')
    test.skip(
      orderId === null,
      'no seeded product can be provisioned, so nothing can be ordered — seedDemoData creates no pipeline stack (#157)',
    )
    if (orderId === null) return

    const { body } = await readOrder(pm, orderId)
    // `pending`, and this is the whole separation of duties: a project manager's
    // order does not provision on its own. `orders.ts` names the rule —
    // "provisioning it immediately for an admin or queueing it for approval for
    // a project manager".
    expect(body?.status, 'a project manager order should be pending, not provisioning').toBe('pending')
  })

  test('the orderer cannot approve their own order', async () => {
    test.skip(offerings.length === 0, 'the catalogue has no product with an environment offering')
    const orderId = await placeOrder(pm, offerings, 'self-approve')
    test.skip(
      orderId === null,
      'no seeded product can be provisioned, so nothing can be ordered — seedDemoData creates no pipeline stack (#157)',
    )
    if (orderId === null) return

    // Not "the button is hidden" — the button being hidden is a UI courtesy, and
    // the route is one fetch away from being called without the page. Both
    // decisions are refused outright.
    const approve = await pm.page.request.post(`/api/proxy/api/approvals/${orderId}/approve`)
    expect(approve.status(), 'a project manager approved an order').toBe(403)

    const reject = await pm.page.request.post(`/api/proxy/api/approvals/${orderId}/reject`, {
      data: { rejectionNote: 'by the orderer' },
    })
    expect(reject.status(), 'a project manager rejected an order').toBe(403)

    // And it is still waiting, so the refusal did not quietly change anything.
    const { body } = await readOrder(pm, orderId)
    expect(body?.status).toBe('pending')
  })

  test('the order reaches the admin approval queue, and the admin rejects it with a note the orderer can read', async () => {
    test.skip(offerings.length === 0, 'the catalogue has no product with an environment offering')
    const orderId = await placeOrder(pm, offerings, 'rejection')
    test.skip(
      orderId === null,
      'no seeded product can be provisioned, so nothing can be ordered — seedDemoData creates no pipeline stack (#157)',
    )
    if (orderId === null) return

    // ── The handover, through the admin's own screen ────────────────────────
    // This is the leg under test, so it is the leg driven through the UI: the
    // approver has to SEE the order in their queue.
    await admin.page.goto('/approvals')
    await hydrated(admin.page)
    await expect(
      admin.page.getByRole('heading', { name: /approvals/i, level: 1 }),
      'the admin cannot open the approval queue',
    ).toBeVisible({ timeout: 30_000 })
    // `#123`, which is how `ApprovalRow.tsx` prints it. A bare number would also
    // match a price, a quantity or another row's id.
    const inQueue = admin.page.getByText(new RegExp(`#${orderId}\\b`))
    await expect(
      inQueue.first(),
      `order ${orderId} never appeared in the admin approval queue`,
    ).toBeVisible({ timeout: 30_000 })

    // The decision itself through the API: the queue's own buttons and dialogs
    // are `approvals.spec.ts`'s subject, and what this test is about is that the
    // decision an admin makes lands on the project manager's order.
    const note = `E2E rejected by ${admin.account.email}`
    const rejectRes = await admin.page.request.post(`/api/proxy/api/approvals/${orderId}/reject`, {
      data: { rejectionNote: note },
    })
    expect(rejectRes.ok(), `the admin could not reject: ${rejectRes.status()} ${await rejectRes.text()}`).toBe(true)

    // ── And the orderer is told, in their own session ───────────────────────
    const { body } = await readOrder(pm, orderId)
    expect(body?.status, 'the order should be rejected').toBe('rejected')
    expect(
      body?.rejectionNote,
      'the rejection note is the only explanation the orderer gets — it must reach them',
    ).toBe(note)

    // Rejected, so it is out of the queue. Left in it, the same order would be
    // decided twice.
    await admin.page.goto('/approvals')
    await hydrated(admin.page)
    await expect(admin.page.getByRole('heading', { name: /approvals/i, level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(
      admin.page.getByText(new RegExp(`#${orderId}\\b`)),
      `rejected order ${orderId} is still in the approval queue`,
    ).toHaveCount(0)
  })

  /**
   * The comment thread, and the one line in it the orderer must never see.
   *
   * An internal note is how an approver talks to the other approvers about an
   * order — "the requester already has three of these", "check with finance
   * first" — and `comments.ts` calls the read filter "the whole security
   * boundary of the feature". A boundary between two roles is not something one
   * session can test: it needs the note written as an admin and the thread read
   * as the project manager, which is what this does.
   */
  test('an admin internal note stays invisible to the project manager who placed the order', async () => {
    test.skip(offerings.length === 0, 'the catalogue has no product with an environment offering')
    const orderId = await placeOrder(pm, offerings, 'comments')
    test.skip(
      orderId === null,
      'no seeded product can be provisioned, so nothing can be ordered — seedDemoData creates no pipeline stack (#157)',
    )
    if (orderId === null) return
    const path = `/api/proxy/api/orders/${orderId}/comments`

    // The orderer's own comment — the ordinary case, and the control for the
    // assertions below: if the thread were simply broken, this would fail here.
    const mine = await pm.page.request.post(path, { data: { body: 'When can I expect this?' } })
    expect(mine.ok(), `the orderer could not comment: ${mine.status()} ${await mine.text()}`).toBe(true)

    // A project manager cannot mark a note internal. Refused by the SERVICE —
    // the request schema accepts the flag, which is exactly why this is worth
    // asserting over HTTP rather than trusting the shape.
    const escalate = await pm.page.request.post(path, {
      data: { body: 'trying to write an internal note', internal: true },
    })
    expect(escalate.status(), 'a project manager wrote an internal note').toBe(403)

    const secret = `E2E internal note ${Date.now()}`
    const note = await admin.page.request.post(path, { data: { body: secret, internal: true } })
    expect(note.ok(), `the admin could not add an internal note: ${note.status()} ${await note.text()}`).toBe(true)

    // The admin sees it...
    const adminThread = await admin.page.request.get(path)
    expect(adminThread.ok()).toBe(true)
    expect(
      JSON.stringify(await adminThread.json()),
      'the admin cannot see the internal note they just wrote',
    ).toContain(secret)

    // ...and the orderer does not. Asserted on the API rather than on the page,
    // because a note filtered out of the response cannot be leaked by any later
    // change to the rendering, and one merely hidden in CSS is already leaked.
    const pmThread = await pm.page.request.get(path)
    expect(pmThread.ok(), 'the orderer cannot read their own order comments').toBe(true)
    const pmBody = JSON.stringify(await pmThread.json())
    expect(pmBody, "an internal note reached the order's own project manager").not.toContain(secret)
    // Their own comment is still there, so this is a filter and not an empty thread.
    expect(pmBody).toContain('When can I expect this?')
  })

  test("one project manager cannot read another's order", async ({ browser }) => {
    test.skip(offerings.length === 0, 'the catalogue has no product with an environment offering')
    const orderId = await placeOrder(pm, offerings, 'isolation')
    test.skip(
      orderId === null,
      'no seeded product can be provisioned, so nothing can be ordered — seedDemoData creates no pipeline stack (#157)',
    )
    if (orderId === null) return

    const other = await actor(browser, 'project_manager')
    try {
      const { status } = await readOrder(other, orderId)
      // `orders.ts` scopes a project manager to their own orders. Anything but a
      // refusal here means one customer can read another's order — its
      // parameters, its project and its price.
      expect(
        status,
        `a project manager read another project manager's order (HTTP ${status})`,
      ).toBeGreaterThanOrEqual(400)
    } finally {
      await other.context.close()
    }
  })
})

test.describe.serial("Process: root withdraws an offering and the shop stops offering it", () => {
  test.setTimeout(240_000)

  let pm: Session
  let root: { request: APIRequestContext; context: BrowserContext }
  let offerings: Offering[]

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000)
    pm = await actor(browser, 'project_manager')
    root = await asRoot(browser)
    offerings = await findOrderableOfferings(root.request)
  })

  test.afterAll(async () => {
    // Put it back, whatever happened: this suite runs against one shared
    // database, and a product this test retired and left retired is a product
    // every later catalogue assertion is missing.
    if (offerings?.length) {
      await root?.request.put(`/api/proxy/api/admin/products/${offerings[0].productId}/retired`, {
        data: { retired: false },
      })
    }
    await pm?.context.close()
    await root?.context.close()
  })

  test('a retired product leaves the project manager catalogue', async () => {
    test.skip(offerings.length === 0, 'the catalogue has no product with an environment offering')
    // Retiring needs no pipeline, so any offered product will do — the first.
    const { productId } = offerings[0]

    // Visible to the customer first, so the assertion after the retirement is
    // about the retirement and not about a product that was never there.
    const before = await pm.page.request.get(`/api/proxy/api/catalog/${productId}?lang=en`)
    expect(before.ok(), 'the product is not in the catalogue to begin with').toBe(true)

    const retire = await root.request.put(`/api/proxy/api/admin/products/${productId}/retired`, {
      data: { retired: true },
    })
    expect(retire.ok(), `root could not retire the product: ${retire.status()}`).toBe(true)

    const after = await pm.page.request.get(`/api/proxy/api/catalog/${productId}?lang=en`)
    expect(
      after.ok(),
      'a retired product is still being served to the shop — it can still be ordered',
    ).toBe(false)
  })
})

test.describe.serial('Process: root takes an account away', () => {
  test.setTimeout(180_000)

  test('a deactivated account can no longer sign in', async ({ browser }) => {
    const root = await asRoot(browser)
    let account: TestAccount
    try {
      account = await createAccount(await root.context.newPage(), 'project_manager')

      // It works first — otherwise the assertion below proves only that the
      // password was wrong all along.
      const signedIn = await signInAsAccount(browser, account)
      await expect(signedIn.page).not.toHaveURL(/\/login/)
      await signedIn.context.close()

      const off = await root.request.put(`/api/proxy/api/admin/users/${account.id}`, {
        data: { active: false },
      })
      expect(off.ok(), `root could not deactivate the account: ${off.status()}`).toBe(true)
    } finally {
      await root.context.close()
    }

    // And now it does not. A fresh context, because the point is the sign-in and
    // not whether an already-open session survives.
    const context = await browser.newContext({ storageState: undefined })
    try {
      const page = await context.newPage()
      await page.goto('/login')
      await page.getByLabel(/email address/i).fill(account.email)
      await page.getByLabel(/password/i).fill(account.password)
      await page.getByRole('button', { name: /sign in/i }).click()
      // Still on /login is the assertion. Waiting for a specific error message
      // would be asserting the copy; being refused is the behaviour.
      await page.waitForTimeout(3_000)
      await expect(page, 'a deactivated account signed in').toHaveURL(/\/login/)
    } finally {
      await context.close()
    }
  })
})
