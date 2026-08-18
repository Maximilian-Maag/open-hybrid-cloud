import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'

vi.mock('@/lib/notification', () => ({
  sendOrderComment: vi.fn().mockResolvedValue(undefined),
}))

import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  countCommentsForOrders,
  MAX_COMMENT_LENGTH,
} from './comments'
import { sendOrderComment } from '@/lib/notification'
import { db } from '@/lib/db/client'
import { orderComments, auditLog } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const mockedNotify = vi.mocked(sendOrderComment)

beforeEach(() => {
  mockedNotify.mockReset().mockResolvedValue(undefined)
})

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'c-admin@test.dev', name: 'Admin One' })
  const otherAdmin = await createUser({ role: 'admin', email: 'c-admin2@test.dev', name: 'Admin Two' })
  const pm = await createUser({ role: 'project_manager', email: 'c-pm@test.dev', name: 'PM One' })
  const outsider = await createUser({ role: 'project_manager', email: 'c-out@test.dev', name: 'Outsider' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await seedOrder(project.id, product.id, env.id, pm.id)
  return { admin, otherAdmin, pm, outsider, order }
}

describe('createComment', () => {
  it('stores a public comment from the orderer', async () => {
    const { pm, order } = await setup()
    const result = await createComment(makeSession(pm), order.id, { body: 'Any update?' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ body: 'Any update?', internal: false, userName: 'PM One' })
  })

  it('trims the body and rejects a blank one', async () => {
    const { pm, order } = await setup()
    const trimmed = await createComment(makeSession(pm), order.id, { body: '  spaced  ' })
    expect(trimmed.ok && trimmed.data.body).toBe('spaced')

    for (const body of ['', '   ', '\n\t']) {
      const blank = await createComment(makeSession(pm), order.id, { body })
      expect(blank.ok).toBe(false)
      if (!blank.ok) expect(blank.status).toBe(400)
    }
  })

  it('rejects a body over the length limit', async () => {
    const { pm, order } = await setup()
    const result = await createComment(makeSession(pm), order.id, { body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('returns 404 for an unknown order', async () => {
    const { pm } = await setup()
    const result = await createComment(makeSession(pm), 999_999, { body: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('forbids a project manager commenting on somebody else\'s order', async () => {
    const { outsider, order } = await setup()
    const result = await createComment(makeSession(outsider), order.id, { body: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('lets an admin comment on any order', async () => {
    const { admin, order } = await setup()
    const result = await createComment(makeSession(admin), order.id, { body: 'Procurement ref 4711' })
    expect(result.ok).toBe(true)
  })

  it('forbids a project manager from marking a comment internal', async () => {
    // Otherwise the orderer could write a note they believe is hidden from
    // themselves, which is incoherent, and worse, could hide it from nobody.
    const { pm, order } = await setup()
    const result = await createComment(makeSession(pm), order.id, { body: 'secret', internal: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    expect(await db.select().from(orderComments)).toHaveLength(0)
  })

  it('lets an admin mark a comment internal', async () => {
    const { admin, order } = await setup()
    const result = await createComment(makeSession(admin), order.id, { body: 'Approved verbally', internal: true })
    expect(result.ok && result.data.internal).toBe(true)
  })

  it('audits a comment with its body, so the thread survives a later delete', async () => {
    const { pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'Any update?' })

    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'order.comment_added'))
    expect(entries).toHaveLength(1)
    expect(entries[0].entityId).toBe(order.id)
    expect(entries[0].details).toContain('Any update?')
  })

  it('audits an internal note under its own action', async () => {
    const { admin, order } = await setup()
    await createComment(makeSession(admin), order.id, { body: 'internal', internal: true })

    const actions = (await db.select().from(auditLog)).map((a) => a.action)
    expect(actions).toContain('order.comment_internal_added')
    expect(actions).not.toContain('order.comment_added')
  })
})

describe('createComment — notifications', () => {
  it('emails the orderer and the admins, but not the author', async () => {
    const { admin, order } = await setup()
    await createComment(makeSession(admin), order.id, { body: 'Looking into it' })

    const recipients = mockedNotify.mock.calls.map((c) => c[0])
    expect(recipients).toContain('c-pm@test.dev')
    expect(recipients).toContain('c-admin2@test.dev')
    // The author already knows what they just wrote.
    expect(recipients).not.toContain('c-admin@test.dev')
  })

  it('notifies each recipient exactly once', async () => {
    // An admin who is also the orderer must not get two copies.
    const admin = await createUser({ role: 'admin', email: 'dual@test.dev', name: 'Dual' })
    const other = await createUser({ role: 'admin', email: 'dual-other@test.dev', name: 'Other' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'P')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(admin.id)
    const order = await seedOrder(project.id, product.id, env.id, admin.id)

    await createComment(makeSession(other), order.id, { body: 'hello' })
    const recipients = mockedNotify.mock.calls.map((c) => c[0])
    expect(recipients.filter((r) => r === 'dual@test.dev')).toHaveLength(1)
  })

  it('sends nothing at all for an internal note', async () => {
    // Telling the orderer that a note they cannot read exists would leak exactly
    // what the flag is for.
    const { admin, order } = await setup()
    await createComment(makeSession(admin), order.id, { body: 'internal', internal: true })
    expect(mockedNotify).not.toHaveBeenCalled()
  })

  it('passes the author name and body through to the email', async () => {
    const { pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'Please expedite' })

    expect(mockedNotify).toHaveBeenCalledWith(
      expect.any(String),
      'Nginx Gateway',
      order.id,
      'PM One',
      'Please expedite',
    )
  })
})

describe('listComments', () => {
  it('returns the thread oldest first', async () => {
    const { pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'first' })
    await createComment(makeSession(pm), order.id, { body: 'second' })

    const result = await listComments(makeSession(pm), order.id)
    expect(result.ok && result.data.map((c) => c.body)).toEqual(['first', 'second'])
  })

  it('hides internal notes from the orderer', async () => {
    // This is the security boundary of the feature: an internal note is written on
    // the assumption the orderer never reads it, so it must not reach their
    // browser at all.
    const { admin, pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'public' })
    await createComment(makeSession(admin), order.id, { body: 'internal', internal: true })

    const asPm = await listComments(makeSession(pm), order.id)
    expect(asPm.ok && asPm.data.map((c) => c.body)).toEqual(['public'])

    const asAdmin = await listComments(makeSession(admin), order.id)
    expect(asAdmin.ok && asAdmin.data.map((c) => c.body)).toEqual(['public', 'internal'])
  })

  it('resolves the author name', async () => {
    const { pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'hi' })

    const result = await listComments(makeSession(pm), order.id)
    expect(result.ok && result.data[0].userName).toBe('PM One')
  })

  it('marks an unedited comment as not edited', async () => {
    const { pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'hi' })

    const result = await listComments(makeSession(pm), order.id)
    expect(result.ok && result.data[0].edited).toBe(false)
  })

  it('forbids reading another project manager\'s order thread', async () => {
    const { outsider, order } = await setup()
    const result = await listComments(makeSession(outsider), order.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('returns an empty thread rather than an error', async () => {
    const { pm, order } = await setup()
    const result = await listComments(makeSession(pm), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})

describe('updateComment', () => {
  it('lets the author edit and marks it edited', async () => {
    const { pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'befor' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const result = await updateComment(makeSession(pm), order.id, created.data.id, 'before')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toMatchObject({ body: 'before', edited: true })

    const listed = await listComments(makeSession(pm), order.id)
    expect(listed.ok && listed.data[0].edited).toBe(true)
  })

  it('refuses to let anyone but the author edit — admins included', async () => {
    // An admin rewriting somebody else's words under their name is worse than
    // leaving a correction in the thread.
    const { admin, pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'mine' })
    if (!created.ok) throw new Error('setup failed')

    const result = await updateComment(makeSession(admin), order.id, created.data.id, 'rewritten')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('keeps the original text in the audit log', async () => {
    const { pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'original' })
    if (!created.ok) throw new Error('setup failed')

    await updateComment(makeSession(pm), order.id, created.data.id, 'revised')
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'order.comment_edited'))
    expect(entry.details).toContain('original')
    expect(entry.details).toContain('revised')
  })

  it('rejects a blank edit', async () => {
    const { pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'text' })
    if (!created.ok) throw new Error('setup failed')

    const result = await updateComment(makeSession(pm), order.id, created.data.id, '   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('returns 404 for an unknown comment', async () => {
    const { pm, order } = await setup()
    const result = await updateComment(makeSession(pm), order.id, 999_999, 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('will not reach a comment through a different order\'s id', async () => {
    // Otherwise an admin who can see order B could mutate a comment on order A.
    const { admin, pm, order } = await setup()
    const created = await createComment(makeSession(admin), order.id, { body: 'on order A' })
    if (!created.ok) throw new Error('setup failed')

    const otherOrder = await seedOrder(order.projectId, order.productId, order.environmentId, pm.id)
    const result = await updateComment(makeSession(admin), otherOrder.id, created.data.id, 'moved')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('hides an internal note behind 404 for a non-admin, not 403', async () => {
    // A 403 would confirm that a note exists, which is the thing being hidden.
    const { admin, pm, order } = await setup()
    const created = await createComment(makeSession(admin), order.id, { body: 'internal', internal: true })
    if (!created.ok) throw new Error('setup failed')

    const result = await updateComment(makeSession(pm), order.id, created.data.id, 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('deleteComment', () => {
  it('lets the author delete their own comment', async () => {
    const { pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'oops' })
    if (!created.ok) throw new Error('setup failed')

    const result = await deleteComment(makeSession(pm), order.id, created.data.id)
    expect(result.ok).toBe(true)
    expect(await db.select().from(orderComments)).toHaveLength(0)
  })

  it('keeps the body in the audit log', async () => {
    // A hard delete rather than a tombstone: the immutable log holds the trail, so
    // no "deleted" placeholder is needed to announce that something was withdrawn.
    const { pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'withdrawn text' })
    if (!created.ok) throw new Error('setup failed')

    await deleteComment(makeSession(pm), order.id, created.data.id)
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'order.comment_deleted'))
    expect(entry.details).toContain('withdrawn text')
  })

  it('refuses to let a non-author delete', async () => {
    const { admin, pm, order } = await setup()
    const created = await createComment(makeSession(pm), order.id, { body: 'mine' })
    if (!created.ok) throw new Error('setup failed')

    const result = await deleteComment(makeSession(admin), order.id, created.data.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    expect(await db.select().from(orderComments)).toHaveLength(1)
  })

  it('cascades away with the order', async () => {
    const { pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'hi' })
    await db.execute(`DELETE FROM orders WHERE id = ${order.id}` as never)
    expect(await db.select().from(orderComments)).toHaveLength(0)
  })
})

describe('countCommentsForOrders', () => {
  it('counts per order and excludes internal notes for a non-admin', async () => {
    const { admin, pm, order } = await setup()
    await createComment(makeSession(pm), order.id, { body: 'one' })
    await createComment(makeSession(pm), order.id, { body: 'two' })
    await createComment(makeSession(admin), order.id, { body: 'internal', internal: true })

    const asPm = await countCommentsForOrders(makeSession(pm), [order.id])
    expect(asPm.get(order.id)).toBe(2)

    const asAdmin = await countCommentsForOrders(makeSession(admin), [order.id])
    expect(asAdmin.get(order.id)).toBe(3)
  })

  it('omits orders with no comments rather than reporting zero', async () => {
    const { pm, order } = await setup()
    const counts = await countCommentsForOrders(makeSession(pm), [order.id])
    expect(counts.has(order.id)).toBe(false)
  })

  it('returns an empty map for no ids, without querying', async () => {
    const { pm } = await setup()
    expect(await countCommentsForOrders(makeSession(pm), [])).toEqual(new Map())
  })
})
