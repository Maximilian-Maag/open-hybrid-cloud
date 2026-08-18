import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { db } from '@/lib/db/client'
import { orders, parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
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
  createCostCenter,
} from '@/test/helpers'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

const URL_BASE = 'http://localhost/api/infrastructure/export'

/**
 * Two elements in different environments, one of them with a cost centre and
 * both carrying a sensitive and a non-sensitive parameter.
 */
const seed = async () => {
  const admin = await createUser({ role: 'admin', email: 'exp-admin@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'exp-pm@test.dev' })
  const cat = await createCategory()
  const nginx = await createProduct(cat.id, 'Nginx Gateway')
  const postgres = await createProduct(cat.id, 'Managed Postgres')
  const ci = await createCiSource()
  const frankfurt = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  const vienna = await createEnvironment(ci.id, undefined, 'On-Premise Vienna')
  const project = await createProject(pm.id, 'Webshop Platform')
  const cc = await createCostCenter({ code: 'CC-42', name: 'Platform Team' })

  await db.insert(parameters).values([
    { scope: 'product', scopeId: nginx.id, name: 'hostname', type: 'string' },
    { scope: 'product', scopeId: nginx.id, name: 'admin_password', type: 'string', sensitive: true },
  ])

  const o1 = await seedOrder(project.id, nginx.id, frankfurt.id, pm.id)
  await db.update(orders).set({ costCenterId: cc.id }).where(eq(orders.id, o1.id))
  const el1 = await createInfraElement(o1.id, project.id, frankfurt.id, nginx.id, {
    parameters: { hostname: 'web-01', admin_password: 'sup3rs3cret' },
    deployedAt: new Date('2026-03-01T00:00:00.000Z'),
  })

  const o2 = await seedOrder(project.id, postgres.id, vienna.id, pm.id)
  const el2 = await createInfraElement(o2.id, project.id, vienna.id, postgres.id, {
    status: 'decommissioned',
    deployedAt: new Date('2026-05-01T00:00:00.000Z'),
  })

  return { admin, pm, nginx, postgres, frankfurt, vienna, project, cc, el1, el2 }
}

const auth = async (user: Parameters<typeof makeAuthHeader>[0]) => makeAuthHeader(user)

describe('GET /api/infrastructure/export', () => {
  it('returns 401 without an auth token', async () => {
    const res = await GET(makeReq(URL_BASE))
    expect(res.status).toBe(401)
  })

  it('returns 403 for a project manager', async () => {
    // The list is visible to a PM, but a downloadable inventory file is a
    // reporting artefact — same bar as the audit export.
    const { pm } = await seed()
    const res = await GET(makeReq(URL_BASE, await auth(pm)))
    expect(res.status).toBe(403)
  })

  it('serves CSV with the inventory columns by default', async () => {
    const { admin } = await seed()
    const res = await GET(makeReq(URL_BASE, await auth(admin)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(res.headers.get('content-disposition')).toContain('infrastructure.csv')

    const text = await res.text()
    expect(text.split('\n')[0]).toBe('id,product,environment,project,costCenter,status,deployedAt')
    expect(text).toContain('Nginx Gateway')
    expect(text).toContain('AWS Frankfurt')
    expect(text).toContain('Webshop Platform')
  })

  it('includes the order\'s cost centre and leaves it blank when there is none', async () => {
    const { admin, el1, el2 } = await seed()
    const res = await GET(makeReq(URL_BASE, await auth(admin)))
    const lines = (await res.text()).split('\n')

    const withCc = lines.find((l) => l.startsWith(`${el1.id},`))
    expect(withCc).toContain('CC-42 — Platform Team')

    // 'project' cost-centre mode stores none on the order; the cell stays empty
    // rather than inventing a label.
    const withoutCc = lines.find((l) => l.startsWith(`${el2.id},`))
    expect(withoutCc?.split(',')).toContain('')
  })

  it('omits the parameters column unless it is asked for', async () => {
    const { admin } = await seed()
    const res = await GET(makeReq(URL_BASE, await auth(admin)))
    const text = await res.text()
    // A column of empty cells would read as "this element has no parameters".
    expect(text.split('\n')[0]).not.toContain('parameters')
    expect(text).not.toContain('hostname=')
  })

  it('includes parameters when requested but redacts the sensitive ones', async () => {
    // An export file gets mailed around and archived; a value flagged sensitive
    // must not travel with it.
    const { admin } = await seed()
    const res = await GET(makeReq(`${URL_BASE}?includeParameters=true`, await auth(admin)))
    const text = await res.text()

    expect(text.split('\n')[0]).toContain('parameters')
    expect(text).toContain('hostname=web-01')
    expect(text).toContain('admin_password=[redacted]')
    expect(text).not.toContain('sup3rs3cret')
  })

  it('applies the same filters as the list', async () => {
    const { admin, el1, el2 } = await seed()

    const byEnv = await GET(makeReq(`${URL_BASE}?search=frankfurt`, await auth(admin)))
    const envText = await byEnv.text()
    expect(envText).toContain('Nginx Gateway')
    expect(envText).not.toContain('Managed Postgres')

    const byStatus = await GET(makeReq(`${URL_BASE}?status=decommissioned`, await auth(admin)))
    const statusLines = (await byStatus.text()).split('\n').slice(1).filter(Boolean)
    expect(statusLines).toHaveLength(1)
    expect(statusLines[0].startsWith(`${el2.id},`)).toBe(true)

    const byDate = await GET(makeReq(`${URL_BASE}?deployedTo=2026-04-01`, await auth(admin)))
    const dateLines = (await byDate.text()).split('\n').slice(1).filter(Boolean)
    expect(dateLines).toHaveLength(1)
    expect(dateLines[0].startsWith(`${el1.id},`)).toBe(true)
  })

  it('honours the requested sort order', async () => {
    const { admin, el1, el2 } = await seed()
    const res = await GET(makeReq(`${URL_BASE}?sort=date&direction=asc`, await auth(admin)))
    const ids = (await res.text()).split('\n').slice(1).filter(Boolean).map((l) => Number(l.split(',')[0]))
    expect(ids).toEqual([el1.id, el2.id])
  })

  it('rejects a malformed filter rather than exporting everything', async () => {
    // Silently ignoring it would produce a file that looks filtered and is not.
    const { admin } = await seed()
    const res = await GET(makeReq(`${URL_BASE}?status=activ`, await auth(admin)))
    expect(res.status).toBe(400)
  })

  it('rejects an unknown format', async () => {
    const { admin } = await seed()
    const res = await GET(makeReq(`${URL_BASE}?format=xlsx`, await auth(admin)))
    expect(res.status).toBe(400)
  })

  it('serves a PDF when asked, branded with the configured shop name', async () => {
    const { admin } = await seed()
    const res = await GET(makeReq(`${URL_BASE}?format=pdf`, await auth(admin)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('infrastructure.pdf')

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    // %PDF magic — a truncated or error body would not carry it.
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF')
  })

  it('neutralises CSV formula injection in a parameter value', async () => {
    const admin = await createUser({ role: 'admin', email: 'inject-admin@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'inject-pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Injected')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id, {
      parameters: { note: '=cmd|\'/C calc\'!A1' },
    })

    const res = await GET(makeReq(`${URL_BASE}?includeParameters=true`, await auth(admin)))
    const text = await res.text()
    // The cell is quoted, and the payload is apostrophe-prefixed so a spreadsheet
    // treats it as text. Here the '=' is mid-cell (after "note="), so the leading
    // character of the cell is what matters.
    expect(text).toContain('note=')
    expect(text).not.toMatch(/(^|,)=cmd/m)
  })

  it('returns just a header row when nothing matches', async () => {
    const { admin } = await seed()
    const res = await GET(makeReq(`${URL_BASE}?search=zzz-nothing-zzz`, await auth(admin)))
    expect(res.status).toBe(200)
    const lines = (await res.text()).split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
  })
})
