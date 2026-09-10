import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { productTranslations } from '@/lib/db/schema'
import { GET } from './route'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder,
  makeAuthHeader,
} from '@/test/helpers'

const req = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/dashboard', () => {
  it('returns 401 without an auth token', async () => {
    const res = await GET(req('http://localhost/api/dashboard'))
    expect(res.status).toBe(401)
  })

  // The HTTP surface, not the service: that the route reaches the service at
  // all, that it scopes to the caller rather than to whoever asked, and that
  // `?lang=` is read off the query string and not ignored.
  it('answers with the caller\'s own counters', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const other = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Virtual Machine')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const mine = await createProject(pm.id, 'Mine')
    const theirs = await createProject(other.id, 'Theirs')
    await createOrder(mine.id, product.id, env.id, pm.id, { status: 'pending' })
    await createOrder(theirs.id, product.id, env.id, other.id, { status: 'pending' })

    const res = await GET(req('http://localhost/api/dashboard', await makeAuthHeader(pm)))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toEqual({ total: 1, pending: 1 })
    expect(body.projects.total).toBe(1)
    expect(body.recentOrders).toHaveLength(1)
    expect(body.recentOrders[0].projectName).toBe('Mine')
  })

  it('reads ?lang= from the query string', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Virtual Machine')
    await db.insert(productTranslations).values({
      productId: product.id,
      languageCode: 'de',
      name: 'Virtuelle Maschine',
      description: '',
    })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    await createOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })

    const auth = await makeAuthHeader(pm)
    const de = await (await GET(req('http://localhost/api/dashboard?lang=de', auth))).json()
    const en = await (await GET(req('http://localhost/api/dashboard', auth))).json()

    expect(de.recentOrders[0].productName).toBe('Virtuelle Maschine')
    expect(en.recentOrders[0].productName).toBe('Virtual Machine')
  })
})
