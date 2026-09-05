import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/notification', () => ({
  sendOrderComment: vi.fn().mockResolvedValue(undefined),
}))

import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { db } from '@/lib/db/client'
import { auditLog, orderComments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
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

const req = (body?: unknown, auth?: string, method = 'PUT') =>
  new NextRequest('http://localhost/api/orders/1/comments/1', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(auth ? { headers: { authorization: auth, 'content-type': 'application/json' } } : {}),
  })

/** A raw request whose body is not JSON at all. */
const brokenBodyReq = (auth: string) =>
  new NextRequest('http://localhost/api/orders/1/comments/1', {
    method: 'PUT',
    body: '{',
    headers: { authorization: auth, 'content-type': 'application/json' },
  })

const p = (orderId: string | number, commentId: string | number) => ({
  params: Promise.resolve({ id: String(orderId), commentId: String(commentId) }),
})

const comment = async (
  orderId: number,
  userId: number,
  body: string,
  internal = false,
) => {
  const [row] = await db.insert(orderComments).values({ orderId, userId, body, internal }).returning()
  return row
}

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'cc-admin@test.dev', name: 'Admin' })
  const pm = await createUser({ role: 'project_manager', email: 'cc-pm@test.dev', name: 'PM' })
  const outsider = await createUser({ role: 'project_manager', email: 'cc-out@test.dev', name: 'Out' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await seedOrder(project.id, product.id, env.id, pm.id)
  // A second order, owned by the same project manager, to prove the comment id is
  // scoped by order and not merely by comment.
  const otherOrder = await seedOrder(project.id, product.id, env.id, pm.id)

  return {
    admin,
    pm,
    outsider,
    order,
    otherOrder,
    adminAuth: await makeAuthHeader(admin),
    pmAuth: await makeAuthHeader(pm),
    outsiderAuth: await makeAuthHeader(outsider),
  }
}

const bodyOf = async (commentId: number) => {
  const [row] = await db.select().from(orderComments).where(eq(orderComments.id, commentId))
  return row?.body
}

describe('PUT /api/orders/{id}/comments/{commentId}', () => {
  it('returns 401 without a token', async () => {
    const { order } = await setup()
    expect((await PUT(req({ body: 'x' }), p(order.id, 1))).status).toBe(401)
  })

  it('lets the author edit their own comment', async () => {
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'Any update?')

    const res = await PUT(req({ body: 'Any update yet?' }, pmAuth), p(order.id, existing.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ body: 'Any update yet?', edited: true })
    expect(await bodyOf(existing.id)).toBe('Any update yet?')
  })

  it('keeps the original text in the audit log', async () => {
    // A hard edit would otherwise erase what was actually said.
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'Original')

    await PUT(req({ body: 'Rewritten' }, pmAuth), p(order.id, existing.id))

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'order.comment_edited'))
    expect(entry.details).toContain('Original')
    expect(entry.details).toContain('Rewritten')
    expect(entry.entityId).toBe(order.id)
  })

  it('trims the stored body', async () => {
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'x')

    await PUT(req({ body: '  spaced  ' }, pmAuth), p(order.id, existing.id))
    expect(await bodyOf(existing.id)).toBe('spaced')
  })

  it('forbids an admin from rewriting somebody else\'s words', async () => {
    // Author-only, admins included: a correction in the thread is better than an
    // admin editing a comment that still carries the orderer's name.
    const { order, pm, adminAuth } = await setup()
    const theirs = await comment(order.id, pm.id, 'Mine')

    const res = await PUT(req({ body: 'Hijacked' }, adminAuth), p(order.id, theirs.id))
    expect(res.status).toBe(403)
    expect(await bodyOf(theirs.id)).toBe('Mine')
  })

  it('forbids the orderer from editing an admin\'s reply on their own order', async () => {
    const { order, admin, pmAuth } = await setup()
    const theirs = await comment(order.id, admin.id, 'Looking into it')

    const res = await PUT(req({ body: 'Fixed already' }, pmAuth), p(order.id, theirs.id))
    expect(res.status).toBe(403)
    expect(await bodyOf(theirs.id)).toBe('Looking into it')
  })

  it('forbids a project manager on somebody else\'s order before the comment is even looked up', async () => {
    const { order, pm, outsiderAuth } = await setup()
    const theirs = await comment(order.id, pm.id, 'Mine')

    const res = await PUT(req({ body: 'x' }, outsiderAuth), p(order.id, theirs.id))
    expect(res.status).toBe(403)
    expect(await bodyOf(theirs.id)).toBe('Mine')
  })

  it('cannot reach a comment through another order\'s URL', async () => {
    // Both ids are scoped together, so a comment id from order A is a 404 on
    // order B — which is what stops an admin who can see B from mutating A's thread.
    const { order, otherOrder, pm, pmAuth, adminAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'On the first order')

    expect((await PUT(req({ body: 'moved' }, pmAuth), p(otherOrder.id, existing.id))).status).toBe(404)
    expect((await PUT(req({ body: 'moved' }, adminAuth), p(otherOrder.id, existing.id))).status).toBe(404)
    expect(await bodyOf(existing.id)).toBe('On the first order')
  })

  it('hides an internal note from the orderer as a 404, not a 403', async () => {
    // A 403 would tell the orderer that a note they cannot read exists, which is
    // the very thing the flag is for.
    const { order, admin, pmAuth } = await setup()
    const note = await comment(order.id, admin.id, 'internal', true)

    const res = await PUT(req({ body: 'x' }, pmAuth), p(order.id, note.id))
    expect(res.status).toBe(404)
    expect(await bodyOf(note.id)).toBe('internal')
  })

  it('returns 404 for a comment that does not exist', async () => {
    const { order, pmAuth } = await setup()
    expect((await PUT(req({ body: 'x' }, pmAuth), p(order.id, 999_999))).status).toBe(404)
  })

  it('returns 404 for an order that does not exist', async () => {
    const { pmAuth } = await setup()
    expect((await PUT(req({ body: 'x' }, pmAuth), p(999_999, 1))).status).toBe(404)
  })

  it('rejects a missing body', async () => {
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'Mine')
    expect((await PUT(req(undefined, pmAuth), p(order.id, existing.id))).status).toBe(400)
    expect(await bodyOf(existing.id)).toBe('Mine')
  })

  it('rejects a body that is not JSON at all', async () => {
    const { order, pmAuth } = await setup()
    expect((await PUT(brokenBodyReq(pmAuth), p(order.id, 1))).status).toBe(400)
  })

  it.each([{}, { body: '' }, { body: 42 }, { body: null }, { body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) }])(
    'rejects a body that fails validation (%j)',
    async (body) => {
      const { order, pm, pmAuth } = await setup()
      const existing = await comment(order.id, pm.id, 'Mine')
      expect((await PUT(req(body, pmAuth), p(order.id, existing.id))).status).toBe(400)
      expect(await bodyOf(existing.id)).toBe('Mine')
    },
  )

  it('rejects a whitespace-only body, which passes the schema but not the service', async () => {
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'Mine')
    const res = await PUT(req({ body: '   ' }, pmAuth), p(order.id, existing.id))
    expect(res.status).toBe(400)
    expect(await bodyOf(existing.id)).toBe('Mine')
  })
})

describe('DELETE /api/orders/{id}/comments/{commentId}', () => {
  it('returns 401 without a token', async () => {
    const { order } = await setup()
    expect((await DELETE(req(undefined, undefined, 'DELETE'), p(order.id, 1))).status).toBe(401)
  })

  it('hard-deletes the author\'s own comment and keeps the body in the audit log', async () => {
    // No tombstone: a "deleted" placeholder would tell every reader that something
    // was said and withdrawn. The audit log is what preserves the trail.
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'Never mind')

    const res = await DELETE(req(undefined, pmAuth, 'DELETE'), p(order.id, existing.id))
    expect(res.status).toBe(200)
    expect(await db.select().from(orderComments).where(eq(orderComments.id, existing.id))).toHaveLength(0)

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'order.comment_deleted'))
    expect(entry.details).toContain('Never mind')
  })

  it('forbids an admin from deleting somebody else\'s comment', async () => {
    const { order, pm, adminAuth } = await setup()
    const theirs = await comment(order.id, pm.id, 'Mine')

    expect((await DELETE(req(undefined, adminAuth, 'DELETE'), p(order.id, theirs.id))).status).toBe(403)
    expect(await bodyOf(theirs.id)).toBe('Mine')
  })

  it('forbids a project manager on somebody else\'s order', async () => {
    const { order, pm, outsiderAuth } = await setup()
    const theirs = await comment(order.id, pm.id, 'Mine')

    expect((await DELETE(req(undefined, outsiderAuth, 'DELETE'), p(order.id, theirs.id))).status).toBe(403)
    expect(await bodyOf(theirs.id)).toBe('Mine')
  })

  it('cannot delete a comment through another order\'s URL', async () => {
    const { order, otherOrder, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'On the first order')

    expect((await DELETE(req(undefined, pmAuth, 'DELETE'), p(otherOrder.id, existing.id))).status).toBe(404)
    expect(await bodyOf(existing.id)).toBe('On the first order')
  })

  it('hides an internal note from the orderer as a 404', async () => {
    const { order, admin, pmAuth } = await setup()
    const note = await comment(order.id, admin.id, 'internal', true)

    expect((await DELETE(req(undefined, pmAuth, 'DELETE'), p(order.id, note.id))).status).toBe(404)
    expect(await bodyOf(note.id)).toBe('internal')
  })

  it('lets an admin delete their own internal note', async () => {
    const { order, admin, adminAuth } = await setup()
    const note = await comment(order.id, admin.id, 'internal', true)

    expect((await DELETE(req(undefined, adminAuth, 'DELETE'), p(order.id, note.id))).status).toBe(200)
    expect(await db.select().from(orderComments).where(eq(orderComments.id, note.id))).toHaveLength(0)
  })

  it('returns 404 for a comment that does not exist — a delete is not silently idempotent here', async () => {
    // Unlike the cart, this path loads the comment first so it can audit the body,
    // which means an unknown id is reported rather than swallowed.
    const { order, pmAuth } = await setup()
    expect((await DELETE(req(undefined, pmAuth, 'DELETE'), p(order.id, 999_999))).status).toBe(404)
  })
})

describe('order comment id parsing', () => {
  it.each(['0', '-1', 'abc', '1.5', '', ' ', '5abc', 'NaN', 'Infinity'])(
    'rejects a malformed order id (%j)',
    async (raw) => {
      const { pmAuth } = await setup()
      expect((await PUT(req({ body: 'x' }, pmAuth), p(raw, 1))).status).toBe(400)
      expect((await DELETE(req(undefined, pmAuth, 'DELETE'), p(raw, 1))).status).toBe(400)
    },
  )

  it.each(['0', '-1', 'abc', '1.5', '', ' ', '5abc', 'NaN', 'Infinity'])(
    'rejects a malformed comment id (%j)',
    async (raw) => {
      const { order, pmAuth } = await setup()
      expect((await PUT(req({ body: 'x' }, pmAuth), p(order.id, raw))).status).toBe(400)
      expect((await DELETE(req(undefined, pmAuth, 'DELETE'), p(order.id, raw))).status).toBe(400)
    },
  )

  it('rejects a malformed id before the body is even read', async () => {
    // Cheap check first: a bad path segment must not depend on a parseable body.
    const { pmAuth } = await setup()
    expect((await PUT(req(undefined, pmAuth), p('abc', 'abc'))).status).toBe(400)
  })

  // Issue #143 made digits-only the contract for a route id: `parseRouteId` in
  // lib/http.ts refuses anything `/^\d+$/` does not match. Under the `Number()`
  // parse this route used before, every spelling below resolved to real rows and
  // the edit landed on someone's comment.
  it.each([
    ['hex', (id: number) => `0x${id.toString(16)}`],
    ['exponent', (id: number) => `${id}e0`],
    ['signed', (id: number) => `+${id}`],
    ['whitespace-padded', (id: number) => ` ${id} `],
  ])('refuses a %s spelling of both real ids (#143)', async (_label, spell) => {
    const { order, pm, pmAuth } = await setup()
    const existing = await comment(order.id, pm.id, 'Mine')

    expect(
      (await PUT(req({ body: 'Reached' }, pmAuth), p(spell(order.id), spell(existing.id)))).status,
    ).toBe(400)
    expect(
      (await DELETE(req(undefined, pmAuth, 'DELETE'), p(spell(order.id), spell(existing.id)))).status,
    ).toBe(400)
    expect(await bodyOf(existing.id)).toBe('Mine')
  })
})
