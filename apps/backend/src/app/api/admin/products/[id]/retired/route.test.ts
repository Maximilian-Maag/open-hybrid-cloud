import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createProject, createOrder, makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { products, productEnvironments, auditLog } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

/**
 * Taking a product out of the catalogue, and putting it back (#251).
 *
 * `retiredAt` already meant exactly "not in the catalogue" — it was simply not a
 * control anyone could reach. Nothing set it deliberately, nothing cleared it,
 * and the admin screens hid what it marked, so pressing Delete on a product that
 * had ever been ordered withdrew it with no way back short of a database update.
 */

const makeReq = (id: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${id}/retired`, {
    method: 'PUT',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function offeredProduct() {
  const root = await createUser({ role: 'root' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id, { price: '42.00' })
  return { root, product, env, auth: await makeAuthHeader(root) }
}

describe('PUT /api/admin/products/[id]/retired', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await PUT(makeReq('1', { retired: true }), ctx('1'))).status).toBe(401)
  })

  // Every other product mutation is root-only, and the page redirects a non-root
  // admin away. A route is one fetch away from being called without the page.
  it('refuses an admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const res = await PUT(makeReq('1', { retired: true }, await makeAuthHeader(admin)), ctx('1'))
    expect(res.status).toBe(403)
  })

  it('withdraws the product from the catalogue', async () => {
    const { product, auth } = await offeredProduct()

    const res = await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))

    expect(res.status).toBe(200)
    const [row] = await db.select().from(products).where(eq(products.id, product.id))
    expect(row.retiredAt).toBeInstanceOf(Date)
  })

  /*
   * The half that did not exist. `retiredAt` was one-way: no code path cleared
   * it, so a product withdrawn by a Delete press stayed withdrawn for good.
   */
  it('puts it back', async () => {
    const { product, auth } = await offeredProduct()
    await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))

    const res = await PUT(makeReq(String(product.id), { retired: false }, auth), ctx(String(product.id)))

    expect(res.status).toBe(200)
    const [row] = await db.select().from(products).where(eq(products.id, product.id))
    expect(row.retiredAt).toBeNull()
  })

  /*
   * What makes it reversible in any useful sense: the offerings survive.
   *
   * Withdrawing used to DELETE product_environments, because the flag only kept
   * the product out of the catalogue's reads and the missing offering was what
   * actually made it unorderable. That destroyed the price, the currency and the
   * cost-centre mode, with nothing to restore them from — so a product put back
   * was not the product it had been.
   */
  it('leaves the offerings alone, so it comes back at the price it had', async () => {
    const { product, env, auth } = await offeredProduct()

    await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))

    const [offering] = await db
      .select()
      .from(productEnvironments)
      .where(eq(productEnvironments.productId, product.id))
    expect(offering).toBeDefined()
    expect(offering.price).toBe('42.00')
    expect(offering.environmentId).toBe(env.id)
  })

  // Already in the asked-for state: not an error — the caller wanted it disabled
  // and it is disabled — but not an audit entry either.
  it('is idempotent, and does not log a change that did not happen', async () => {
    const { product, auth } = await offeredProduct()
    await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))

    const res = await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))
    expect(res.status).toBe(200)

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'product.disabled'))
    expect(entries).toHaveLength(1)
  })

  it('records who did it, and which direction', async () => {
    const { root, product, auth } = await offeredProduct()
    await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))
    await PUT(makeReq(String(product.id), { retired: false }, auth), ctx(String(product.id)))

    const [latest] = await db
      .select().from(auditLog)
      .where(eq(auditLog.action, 'product.enabled'))
      .orderBy(desc(auditLog.id)).limit(1)
    expect(latest.userId).toBe(root.id)
    expect(latest.details).toMatch(/returned to the catalogue/i)
  })

  // A product that has been ordered is exactly the one this exists for: it cannot
  // be deleted, because its orders reference it (#142).
  it('withdraws a product that has orders against it', async () => {
    const { product, env, auth } = await offeredProduct()
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)
    await createOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })

    const res = await PUT(makeReq(String(product.id), { retired: true }, auth), ctx(String(product.id)))

    expect(res.status).toBe(200)
    const [row] = await db.select().from(products).where(eq(products.id, product.id))
    expect(row.retiredAt).toBeInstanceOf(Date)
  })

  it('answers 404 for a product that is not there', async () => {
    const { auth } = await offeredProduct()
    expect((await PUT(makeReq('999999', { retired: true }, auth), ctx('999999'))).status).toBe(404)
  })

  it.each([
    ['no body at all', undefined],
    ['no flag', {}],
    ['a string instead of a boolean', { retired: 'yes' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { product, auth } = await offeredProduct()
    expect((await PUT(makeReq(String(product.id), body, auth), ctx(String(product.id)))).status).toBe(400)
  })

  it.each(['0x10', ' 5 ', 'abc', '-1'])('refuses the malformed id %s with 400', async (id) => {
    const { auth } = await offeredProduct()
    expect((await PUT(makeReq(id, { retired: true }, auth), ctx(id))).status).toBe(400)
  })
})
