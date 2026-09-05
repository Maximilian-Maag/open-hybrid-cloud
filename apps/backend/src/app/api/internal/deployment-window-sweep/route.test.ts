import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

import type * as WindowPolicy from '@/lib/services/windowPolicy'

// Only the release is faked; `whenMayItDeploy` and the rest stay real so this
// file cannot pass against a module that no longer exports them.
vi.mock('@/lib/services/windowPolicy', async (orig) => ({
  ...(await orig<typeof WindowPolicy>()),
  releaseDueScheduledOrders: vi.fn(),
}))
import { releaseDueScheduledOrders } from '@/lib/services/windowPolicy'

/**
 * The HTTP surface of the window sweep (#330).
 *
 * The release logic is tested against a real database next door; what is only
 * testable here is who is allowed to trigger it, and how a partial run is
 * reported to whatever scheduler called it.
 */
const SECRET = 'window-sweep-secret'
const mocked = vi.mocked(releaseDueScheduledOrders)

beforeEach(() => {
  process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET = SECRET
  mocked.mockReset().mockResolvedValue({ released: [], failed: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET
  vi.restoreAllMocks()
})

const post = (secret?: string) =>
  new NextRequest('http://localhost/api/internal/deployment-window-sweep', {
    method: 'POST',
    ...(secret === undefined ? {} : { headers: { 'x-sweep-secret': secret } }),
  })

describe('POST /api/internal/deployment-window-sweep', () => {
  it('is disabled with a 503 when the secret is unset, and releases nothing', async () => {
    delete process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET

    const res = await POST(post('anything'))

    expect(res.status).toBe(503)
    expect(mocked).not.toHaveBeenCalled()
  })

  it.each([
    ['no secret', undefined],
    ['the wrong secret', 'nope'],
    ['a prefix of the secret', SECRET.slice(0, 6)],
  ])('refuses %s with a 401 and releases nothing', async (_name, secret) => {
    const res = await POST(post(secret))
    expect(res.status).toBe(401)
    expect(mocked).not.toHaveBeenCalled()
  })

  it('returns 200 and what it released', async () => {
    mocked.mockResolvedValue({ released: [7, 9], failed: [] })
    const res = await POST(post(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ released: [7, 9], failed: [] })
  })

  /*
   * 207, not 500: the orders that released really did release, so the caller
   * must not retry them — but a scheduler that only ever saw 200 would never
   * surface an order whose provisioning is broken.
   */
  it('returns 207 when some orders could not be released', async () => {
    mocked.mockResolvedValue({ released: [7], failed: [{ orderId: 9, reason: 'CI unreachable' }] })

    const res = await POST(post(SECRET))

    expect(res.status).toBe(207)
    expect((await res.json()).failed).toEqual([{ orderId: 9, reason: 'CI unreachable' }])
  })

  it('is 200 with nothing to do, not an error', async () => {
    const res = await POST(post(SECRET))
    expect(res.status).toBe(200)
  })
})
