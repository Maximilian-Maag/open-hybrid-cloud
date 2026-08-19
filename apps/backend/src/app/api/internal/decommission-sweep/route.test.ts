import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue([]),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
} from '@/test/helpers'

const mockedWebhooks = vi.mocked(triggerProductWebhooksTracked)
const mockedStacks = vi.mocked(triggerPipelineStacksTracked)

const SECRET = 'sweep-secret-value'

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] })
  mockedStacks.mockReset().mockResolvedValue({ pipelineIds: [], failures: [] })
  process.env.DECOMMISSION_SWEEP_SECRET = SECRET
})

afterEach(() => {
  delete process.env.DECOMMISSION_SWEEP_SECRET
})

const makeReq = (secret?: string) =>
  new NextRequest('http://localhost/api/internal/decommission-sweep', {
    method: 'POST',
    ...(secret === undefined ? {} : { headers: { 'x-sweep-secret': secret } }),
  })

const dueElement = async () => {
  const pm = await createUser({ role: 'project_manager', email: `sweep-${Math.random()}@test.dev` })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await seedOrder(project.id, product.id, env.id, pm.id)
  const el = await createInfraElement(order.id, project.id, env.id, product.id)
  await db
    .update(infrastructureElements)
    .set({ scheduledDecommissionAt: new Date('2026-01-01T00:00:00.000Z') })
    .where(eq(infrastructureElements.id, el.id))
  return el
}

const status = async (id: number) =>
  (await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, id)))[0].status

describe('POST /api/internal/decommission-sweep', () => {
  it('rejects a long secret that only shares its first 128 characters', async () => {
    // The comparison used to pad both sides to 128 characters and check the total
    // length, so a >128-character secret was verified by its prefix alone.
    const long = 'a'.repeat(200)
    process.env.DECOMMISSION_SWEEP_SECRET = long
    const el = await dueElement()

    const forged = 'a'.repeat(128) + 'b'.repeat(72)
    expect(forged.length).toBe(long.length)
    const res = await POST(makeReq(forged))
    expect(res.status).toBe(401)
    expect(await status(el.id)).toBe('active')
    expect(mockedWebhooks).not.toHaveBeenCalled()
  })

  it('accepts a secret longer than 128 characters', async () => {
    const long = 'x'.repeat(200)
    process.env.DECOMMISSION_SWEEP_SECRET = long
    const el = await dueElement()

    const res = await POST(makeReq(long))
    expect(res.status).toBe(200)
    expect(await status(el.id)).toBe('decommissioning')
  })

  it('returns 503 when no secret is configured', async () => {
    // A deployment that never configured one must not be sweepable by an
    // unauthenticated caller, so the endpoint is off rather than open.
    delete process.env.DECOMMISSION_SWEEP_SECRET
    const el = await dueElement()

    const res = await POST(makeReq('anything'))
    expect(res.status).toBe(503)
    expect(await status(el.id)).toBe('active')
    expect(mockedWebhooks).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'wrong-secret', SECRET + 'x', SECRET.slice(0, -1)])(
    'returns 401 for a bad secret (%s)',
    async (secret) => {
      const el = await dueElement()
      const res = await POST(makeReq(secret))
      expect(res.status).toBe(401)
      expect(await status(el.id)).toBe('active')
      expect(mockedWebhooks).not.toHaveBeenCalled()
    },
  )

  it('tears down the due elements with a valid secret', async () => {
    const el = await dueElement()
    const res = await POST(makeReq(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ decommissioned: [el.id], failed: [] })
    expect(await status(el.id)).toBe('decommissioning')
  })

  it('returns 200 with empty lists when nothing is due', async () => {
    const res = await POST(makeReq(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ decommissioned: [], failed: [] })
  })

  it('reports 207 when some teardowns could not be started', async () => {
    // A scheduler that only ever saw 200 would never surface a product whose
    // destroy triggers are broken.
    const el = await dueElement()
    mockedWebhooks.mockResolvedValue({ pipelineIds: [], failures: ['webhook "a" (#1): boom'] })

    const res = await POST(makeReq(SECRET))
    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.decommissioned).toEqual([])
    expect(body.failed[0]).toMatchObject({ infraId: el.id })
    // Nothing started, so it stays active for the next sweep to retry.
    expect(await status(el.id)).toBe('active')
  })

  it('is idempotent across repeated calls', async () => {
    const el = await dueElement()
    await POST(makeReq(SECRET))
    const second = await POST(makeReq(SECRET))

    expect(await second.json()).toEqual({ decommissioned: [], failed: [] })
    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
    expect(await status(el.id)).toBe('decommissioning')
  })
})
