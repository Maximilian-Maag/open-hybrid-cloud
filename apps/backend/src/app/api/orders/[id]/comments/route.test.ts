import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notification', () => ({
  sendOrderComment: vi.fn().mockResolvedValue(undefined),
}))

import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { PUT, DELETE } from './[commentId]/route'
import { sendOrderComment } from '@/lib/notification'
import { MAX_COMMENT_LENGTH } from '@/lib/services/comments'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
} from '@/test/helpers'

beforeEach(() => {
  vi.mocked(sendOrderComment).mockReset().mockResolvedValue(undefined)
})

const req = (body?: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/orders/1/comments', {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(auth ? { headers: { authorization: auth, 'content-type': 'application/json' } } : {}),
  })

const p = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })
const pc = (id: string | number, commentId: string | number) =>
  ({ params: Promise.resolve({ id: String(id), commentId: String(commentId) }) })

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'cr-admin@test.dev', name: 'Admin' })
  const pm = await createUser({ role: 'project_manager', email: 'cr-pm@test.dev', name: 'PM' })
  const outsider = await createUser({ role: 'project_manager', email: 'cr-out@test.dev', name: 'Out' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await seedOrder(project.id, product.id, env.id, pm.id)
  return {
    order,
    adminAuth: await makeAuthHeader(admin),
    pmAuth: await makeAuthHeader(pm),
    outsiderAuth: await makeAuthHeader(outsider),
  }
}

describe('order comments API', () => {
  it('requires authentication on every verb', async () => {
    const { order } = await setup()
    expect((await GET(req(), p(order.id))).status).toBe(401)
    expect((await POST(req({ body: 'x' }), p(order.id))).status).toBe(401)
    expect((await PUT(req({ body: 'x' }), pc(order.id, 1))).status).toBe(401)
    expect((await DELETE(req(undefined), pc(order.id, 1))).status).toBe(401)
  })

  it('round-trips a comment through POST, GET, PUT and DELETE', async () => {
    const { order, pmAuth } = await setup()

    const created = await POST(req({ body: 'Any update?' }, pmAuth), p(order.id))
    expect(created.status).toBe(201)
    const comment = await created.json()
    expect(comment).toMatchObject({ body: 'Any update?', internal: false })

    const listed = await GET(req(undefined, pmAuth), p(order.id))
    expect(await listed.json()).toMatchObject([{ id: comment.id, body: 'Any update?' }])

    const edited = await PUT(req({ body: 'Any update yet?' }, pmAuth), pc(order.id, comment.id))
    expect(edited.status).toBe(200)
    expect(await edited.json()).toMatchObject({ body: 'Any update yet?', edited: true })

    const removed = await DELETE(req(undefined, pmAuth), pc(order.id, comment.id))
    expect(removed.status).toBe(200)
    const after = await GET(req(undefined, pmAuth), p(order.id))
    expect(await after.json()).toEqual([])
  })

  it('forbids a project manager on somebody else\'s order', async () => {
    const { order, outsiderAuth } = await setup()
    expect((await GET(req(undefined, outsiderAuth), p(order.id))).status).toBe(403)
    expect((await POST(req({ body: 'x' }, outsiderAuth), p(order.id))).status).toBe(403)
  })

  it('lets an admin post an internal note and hides it from the orderer', async () => {
    const { order, adminAuth, pmAuth } = await setup()
    await POST(req({ body: 'internal', internal: true }, adminAuth), p(order.id))

    const asAdmin = await (await GET(req(undefined, adminAuth), p(order.id))).json()
    expect(asAdmin).toHaveLength(1)

    // The note must not reach the orderer's browser at all.
    const asPm = await (await GET(req(undefined, pmAuth), p(order.id))).json()
    expect(asPm).toEqual([])
  })

  it('rejects internal: true from a project manager', async () => {
    const { order, pmAuth } = await setup()
    const res = await POST(req({ body: 'x', internal: true }, pmAuth), p(order.id))
    expect(res.status).toBe(403)
  })

  it.each([{}, { body: '' }, { body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) }, { body: 42 }])(
    'rejects a malformed body (%j)',
    async (body) => {
      const { order, pmAuth } = await setup()
      const res = await POST(req(body, pmAuth), p(order.id))
      expect(res.status).toBe(400)
    },
  )

  it.each(['0', '-1', 'abc'])('rejects a malformed order id (%s)', async (raw) => {
    const { pmAuth } = await setup()
    expect((await GET(req(undefined, pmAuth), p(raw))).status).toBe(400)
    expect((await POST(req({ body: 'x' }, pmAuth), p(raw))).status).toBe(400)
  })

  it.each(['0', 'abc'])('rejects a malformed comment id (%s)', async (raw) => {
    const { order, pmAuth } = await setup()
    expect((await PUT(req({ body: 'x' }, pmAuth), pc(order.id, raw))).status).toBe(400)
    expect((await DELETE(req(undefined, pmAuth), pc(order.id, raw))).status).toBe(400)
  })

  it('returns 404 for an unknown order', async () => {
    const { pmAuth } = await setup()
    expect((await GET(req(undefined, pmAuth), p(999_999))).status).toBe(404)
  })

  it('emails the other participants on a public comment', async () => {
    const { order, adminAuth } = await setup()
    await POST(req({ body: 'Looking into it' }, adminAuth), p(order.id))
    expect(sendOrderComment).toHaveBeenCalledWith(
      'cr-pm@test.dev', 'P', order.id, 'Admin', 'Looking into it',
    )
  })

  it('emails nobody for an internal note', async () => {
    const { order, adminAuth } = await setup()
    await POST(req({ body: 'internal', internal: true }, adminAuth), p(order.id))
    expect(sendOrderComment).not.toHaveBeenCalled()
  })
})
