import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
} from '@/test/helpers'

const req = (auth?: string) =>
  new NextRequest(
    'http://localhost/api/infrastructure/facets',
    auth ? { headers: { authorization: auth } } : undefined,
  )

/**
 * Two projects with infrastructure, owned by two different project managers, so
 * every assertion below can tell "scoped to the owner" from "everything".
 */
const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'if-admin@test.dev' })
  const root = await createUser({ role: 'root', email: 'if-root@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'if-pm@test.dev' })
  const otherPm = await createUser({ role: 'project_manager', email: 'if-other@test.dev' })

  const cat = await createCategory()
  const nginx = await createProduct(cat.id, 'Nginx Gateway')
  const postgres = await createProduct(cat.id, 'Postgres')
  const ci = await createCiSource()
  const frankfurt = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  const zurich = await createEnvironment(ci.id, undefined, 'Baremetal Zurich')

  const mine = await createProject(pm.id, 'Webshop')
  const theirs = await createProject(otherPm.id, 'Hidden Project')

  const a = await seedOrder(mine.id, nginx.id, frankfurt.id, pm.id)
  const b = await seedOrder(theirs.id, postgres.id, zurich.id, otherPm.id)
  await createInfraElement(a.id, mine.id, frankfurt.id, nginx.id)
  await createInfraElement(b.id, theirs.id, zurich.id, postgres.id)

  return {
    pm,
    nginx,
    postgres,
    frankfurt,
    zurich,
    mine,
    theirs,
    adminAuth: await makeAuthHeader(admin),
    rootAuth: await makeAuthHeader(root),
    pmAuth: await makeAuthHeader(pm),
  }
}

const names = (list: { id: number; name: string }[]) => list.map((entry) => entry.name)

describe('GET /api/infrastructure/facets', () => {
  it('returns 401 without a token', async () => {
    await setup()
    expect((await GET(req())).status).toBe(401)
  })

  it('gives an admin the facets of every project', async () => {
    const { adminAuth } = await setup()
    const res = await GET(req(adminAuth))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(names(body.projects)).toEqual(['Hidden Project', 'Webshop'])
    expect(names(body.environments)).toEqual(['AWS Frankfurt', 'Baremetal Zurich'])
    expect(names(body.products)).toEqual(['Nginx Gateway', 'Postgres'])
  })

  it('gives root the same global view as an admin', async () => {
    const { rootAuth } = await setup()
    const body = await (await GET(req(rootAuth))).json()
    expect(names(body.projects)).toEqual(['Hidden Project', 'Webshop'])
  })

  it('scopes a project manager to the projects they own', async () => {
    // The facet lists drive the filter dropdowns, so an unscoped list would leak
    // the names of every other project, product and environment in the estate —
    // even though the list itself is scoped.
    const { pmAuth } = await setup()
    const body = await (await GET(req(pmAuth))).json()

    expect(names(body.projects)).toEqual(['Webshop'])
    expect(names(body.environments)).toEqual(['AWS Frankfurt'])
    expect(names(body.products)).toEqual(['Nginx Gateway'])
  })

  it('returns the ids the filters submit alongside the labels', async () => {
    const { mine, frankfurt, nginx, pmAuth } = await setup()
    const body = await (await GET(req(pmAuth))).json()

    expect(body.projects).toEqual([{ id: mine.id, name: 'Webshop' }])
    expect(body.environments).toEqual([{ id: frankfurt.id, name: 'AWS Frankfurt' }])
    expect(body.products).toEqual([{ id: nginx.id, name: 'Nginx Gateway' }])
  })

  it('lists each facet once however many elements share it', async () => {
    const { pm, mine, frankfurt, nginx, pmAuth } = await setup()
    const extra = await seedOrder(mine.id, nginx.id, frankfurt.id, pm.id)
    await createInfraElement(extra.id, mine.id, frankfurt.id, nginx.id)

    const body = await (await GET(req(pmAuth))).json()
    expect(body.projects).toHaveLength(1)
    expect(body.environments).toHaveLength(1)
    expect(body.products).toHaveLength(1)
  })

  it('sorts every facet by name, so the dropdowns are stable', async () => {
    const { adminAuth } = await setup()
    const body = await (await GET(req(adminAuth))).json()
    for (const key of ['projects', 'environments', 'products'] as const) {
      const sorted = [...names(body[key])].sort((a, b) => a.localeCompare(b))
      expect(names(body[key]), key).toEqual(sorted)
    }
  })

  it('reports empty facets rather than failing when nothing is deployed', async () => {
    const admin = await createUser({ role: 'admin', email: 'if-empty@test.dev' })
    const res = await GET(req(await makeAuthHeader(admin)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ environments: [], projects: [], products: [] })
  })

  it('reports empty facets for a project manager with no infrastructure of their own', async () => {
    await setup()
    const stranger = await createUser({ role: 'project_manager', email: 'if-stranger@test.dev' })
    const body = await (await GET(req(await makeAuthHeader(stranger)))).json()
    expect(body).toEqual({ environments: [], projects: [], products: [] })
  })

  it('offers a facet only while an element still references it', async () => {
    // The facets come from the elements, not from the catalogue, so an environment
    // nobody has deployed into does not appear as a filter option.
    const ci = await createCiSource()
    const unused = await createEnvironment(ci.id, undefined, 'Never Used')
    const { adminAuth } = await setup()

    const body = await (await GET(req(adminAuth))).json()
    expect(body.environments.map((e: { id: number }) => e.id)).not.toContain(unused.id)
  })
})
