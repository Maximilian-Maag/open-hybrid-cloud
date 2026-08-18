import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-destroy']),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
  // The teardown paths use the *Tracked variants so a trigger that fails to
  // start is reported rather than swallowed.
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

import { listInfrastructure, listInfrastructureFacets, decommissionInfra } from './infrastructure'
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

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const mockedWebhooks = vi.mocked(triggerProductWebhooksTracked)
const mockedStacks = vi.mocked(triggerPipelineStacksTracked)

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] })
  mockedStacks.mockReset().mockResolvedValue({ pipelineIds: [], failures: [] })
})

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'admin@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
  const otherPm = await createUser({ role: 'project_manager', email: 'other@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P1')
  const product2 = await createProduct(cat.id, 'P2')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const otherProject = await createProject(otherPm.id)
  return { admin, pm, otherPm, product, product2, env, project, otherProject }
}

describe('listInfrastructure', () => {
  it('admin sees infra from all projects', async () => {
    const { admin, pm, otherPm, product, env, project, otherProject } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(otherProject.id, product.id, env.id, otherPm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, otherProject.id, env.id, product.id)

    const result = await listInfrastructure(makeSession(admin), {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(2)
  })

  it('PM only sees infra from their own projects', async () => {
    const { pm, otherPm, product, env, project, otherProject } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(otherProject.id, product.id, env.id, otherPm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, otherProject.id, env.id, product.id)

    const result = await listInfrastructure(makeSession(pm), {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].projectId).toBe(project.id)
    }
  })

  it('productId filter returns only matching elements', async () => {
    const { admin, pm, product, product2, env, project } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(project.id, product2.id, env.id, pm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, project.id, env.id, product2.id)

    const result = await listInfrastructure(makeSession(admin), { productId: product.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].productId).toBe(product.id)
    }
  })

  it('projectId filter returns only matching elements', async () => {
    const { admin, pm, otherPm, product, env, project, otherProject } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(otherProject.id, product.id, env.id, otherPm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, otherProject.id, env.id, product.id)

    const result = await listInfrastructure(makeSession(admin), { projectId: otherProject.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].projectId).toBe(otherProject.id)
    }
  })
})

// Issue #31. The list previously accepted only productId/projectId, so anything
// beyond a couple of dozen elements had to be eyeballed.
describe('listInfrastructure — search, filtering and sorting', () => {
  const searchable = async () => {
    const admin = await createUser({ role: 'admin', email: 'search-admin@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'search-pm@test.dev' })
    const cat = await createCategory()
    const nginx = await createProduct(cat.id, 'Nginx Gateway')
    const postgres = await createProduct(cat.id, 'Managed Postgres')
    const ci = await createCiSource()
    const frankfurt = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
    const vienna = await createEnvironment(ci.id, undefined, 'On-Premise Vienna')
    const webshop = await createProject(pm.id, 'Webshop Platform')
    const billing = await createProject(pm.id, 'Billing Service')

    const mk = async (
      product: { id: number },
      env: { id: number },
      project: { id: number },
      over?: Parameters<typeof createInfraElement>[4],
    ) => {
      const order = await seedOrder(project.id, product.id, env.id, pm.id)
      return createInfraElement(order.id, project.id, env.id, product.id, over)
    }

    return { admin, pm, nginx, postgres, frankfurt, vienna, webshop, billing, mk }
  }

  const names = (rows: { productName: string }[]) => rows.map((r) => r.productName).sort()

  it('matches the search term against the product name', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop)

    const result = await listInfrastructure(makeSession(ctx.admin), { search: 'nginx' })
    expect(result.ok && names(result.data)).toEqual(['Nginx Gateway'])
  })

  it('matches the search term against the environment and project name too', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.vienna, ctx.webshop)
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.billing)

    const byEnv = await listInfrastructure(makeSession(ctx.admin), { search: 'vienna' })
    expect(byEnv.ok && names(byEnv.data)).toEqual(['Nginx Gateway'])

    const byProject = await listInfrastructure(makeSession(ctx.admin), { search: 'billing' })
    expect(byProject.ok && names(byProject.data)).toEqual(['Managed Postgres'])
  })

  it('searches case-insensitively', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)

    const result = await listInfrastructure(makeSession(ctx.admin), { search: 'NGINX gateway' })
    expect(result.ok && result.data.length).toBe(1)
  })

  it('treats LIKE metacharacters in the search term literally', async () => {
    // An unescaped '%' would match every row, so a search that should find
    // nothing would instead look like it found everything.
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)
    await ctx.mk(ctx.postgres, ctx.vienna, ctx.billing)

    for (const search of ['%', '_', 'Nginx%Gateway']) {
      const result = await listInfrastructure(makeSession(ctx.admin), { search })
      expect(result.ok && result.data.length, search).toBe(0)
    }
  })

  it('never widens a PM beyond their own projects when searching', async () => {
    const ctx = await searchable()
    const outsider = await createUser({ role: 'project_manager', email: 'outsider@test.dev' })
    const theirs = await createProject(outsider.id, 'Webshop Platform Copy')
    const order = await seedOrder(theirs.id, ctx.nginx.id, ctx.frankfurt.id, outsider.id)
    await createInfraElement(order.id, theirs.id, ctx.frankfurt.id, ctx.nginx.id)
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)

    // 'webshop' matches both projects by name, but scope wins over the filter.
    const result = await listInfrastructure(makeSession(ctx.pm), { search: 'webshop' })
    expect(result.ok && result.data.length).toBe(1)
    if (result.ok) expect(result.data[0].projectId).toBe(ctx.webshop.id)
  })

  it('filters by status', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { status: 'active' })
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop, { status: 'decommissioned' })

    const active = await listInfrastructure(makeSession(ctx.admin), { status: 'active' })
    expect(active.ok && names(active.data)).toEqual(['Nginx Gateway'])

    const gone = await listInfrastructure(makeSession(ctx.admin), { status: 'decommissioned' })
    expect(gone.ok && names(gone.data)).toEqual(['Managed Postgres'])
  })

  it('filters by environment', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)
    await ctx.mk(ctx.postgres, ctx.vienna, ctx.webshop)

    const result = await listInfrastructure(makeSession(ctx.admin), { environmentId: ctx.vienna.id })
    expect(result.ok && names(result.data)).toEqual(['Managed Postgres'])
  })

  it('filters by deployed-at range, inclusive of both bounds', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { deployedAt: new Date('2026-03-01T00:00:00.000Z') })
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop, { deployedAt: new Date('2026-05-15T12:00:00.000Z') })

    const inRange = await listInfrastructure(makeSession(ctx.admin), {
      deployedFrom: new Date('2026-04-01T00:00:00.000Z'),
      deployedTo: new Date('2026-06-01T00:00:00.000Z'),
    })
    expect(inRange.ok && names(inRange.data)).toEqual(['Managed Postgres'])

    // The lower bound matches the row's exact timestamp — it must be included.
    const onBoundary = await listInfrastructure(makeSession(ctx.admin), {
      deployedFrom: new Date('2026-03-01T00:00:00.000Z'),
      deployedTo: new Date('2026-03-01T00:00:00.000Z'),
    })
    expect(onBoundary.ok && names(onBoundary.data)).toEqual(['Nginx Gateway'])
  })

  it('combines filters conjunctively', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { status: 'active' })
    await ctx.mk(ctx.nginx, ctx.vienna, ctx.webshop, { status: 'active' })
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { status: 'decommissioned' })

    const result = await listInfrastructure(makeSession(ctx.admin), {
      search: 'nginx',
      environmentId: ctx.frankfurt.id,
      status: 'active',
    })
    expect(result.ok && result.data.length).toBe(1)
  })

  it('defaults to newest-deployed first', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { deployedAt: new Date('2026-01-01T00:00:00.000Z') })
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop, { deployedAt: new Date('2026-06-01T00:00:00.000Z') })

    const result = await listInfrastructure(makeSession(ctx.admin), {})
    expect(result.ok && result.data.map((r) => r.productName)).toEqual(['Managed Postgres', 'Nginx Gateway'])
  })

  it('sorts by name and by status in both directions', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { status: 'decommissioned' })
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop, { status: 'active' })

    const byName = await listInfrastructure(makeSession(ctx.admin), { sort: 'name', direction: 'asc' })
    expect(byName.ok && byName.data.map((r) => r.productName)).toEqual(['Managed Postgres', 'Nginx Gateway'])

    const byNameDesc = await listInfrastructure(makeSession(ctx.admin), { sort: 'name', direction: 'desc' })
    expect(byNameDesc.ok && byNameDesc.data.map((r) => r.productName)).toEqual(['Nginx Gateway', 'Managed Postgres'])

    const byStatus = await listInfrastructure(makeSession(ctx.admin), { sort: 'status', direction: 'asc' })
    expect(byStatus.ok && byStatus.data.map((r) => r.status)).toEqual(['active', 'decommissioned'])
  })

  it('orders rows sharing a sort key deterministically', async () => {
    // An export is expected to match the list it was taken from, so two rows
    // with the same deploy timestamp must not swap places between requests.
    const ctx = await searchable()
    const deployedAt = new Date('2026-04-01T00:00:00.000Z')
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop, { deployedAt })
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop, { deployedAt })
    await ctx.mk(ctx.nginx, ctx.vienna, ctx.webshop, { deployedAt })

    const first = await listInfrastructure(makeSession(ctx.admin), {})
    const second = await listInfrastructure(makeSession(ctx.admin), {})
    expect(first.ok && second.ok && first.data.map((r) => r.id)).toEqual(
      second.ok ? second.data.map((r) => r.id) : [],
    )
  })

  it('returns an empty list rather than an error when nothing matches', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)

    const result = await listInfrastructure(makeSession(ctx.admin), { search: 'no-such-thing' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})

describe('listInfrastructureFacets', () => {
  const searchable = async () => {
    const admin = await createUser({ role: 'admin', email: 'facet-admin@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'facet-pm@test.dev' })
    const cat = await createCategory()
    const nginx = await createProduct(cat.id, 'Nginx Gateway')
    const postgres = await createProduct(cat.id, 'Managed Postgres')
    const ci = await createCiSource()
    const frankfurt = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
    const vienna = await createEnvironment(ci.id, undefined, 'On-Premise Vienna')
    const webshop = await createProject(pm.id, 'Webshop Platform')
    const mk = async (product: { id: number }, env: { id: number }, project: { id: number }) => {
      const order = await seedOrder(project.id, product.id, env.id, pm.id)
      return createInfraElement(order.id, project.id, env.id, product.id)
    }
    return { admin, pm, nginx, postgres, frankfurt, vienna, webshop, mk }
  }

  it('lists each distinct value once, sorted by name', async () => {
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.vienna, ctx.webshop)
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop)
    // A second element in an environment already listed must not duplicate it.
    await ctx.mk(ctx.nginx, ctx.vienna, ctx.webshop)

    const result = await listInfrastructureFacets(makeSession(ctx.admin))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.environments.map((e) => e.name)).toEqual(['AWS Frankfurt', 'On-Premise Vienna'])
    expect(result.data.products.map((p) => p.name)).toEqual(['Managed Postgres', 'Nginx Gateway'])
    expect(result.data.projects.map((p) => p.name)).toEqual(['Webshop Platform'])
  })

  it('omits environments with nothing deployed in them', async () => {
    // Offering one would only let the user filter down to an empty list.
    const ctx = await searchable()
    await ctx.mk(ctx.nginx, ctx.frankfurt, ctx.webshop)

    const result = await listInfrastructureFacets(makeSession(ctx.admin))
    expect(result.ok && result.data.environments.map((e) => e.name)).toEqual(['AWS Frankfurt'])
  })

  it('scopes a PM to their own projects', async () => {
    // The facets must not hint at a project the caller cannot otherwise see.
    const ctx = await searchable()
    const outsider = await createUser({ role: 'project_manager', email: 'facet-outsider@test.dev' })
    const hidden = await createProject(outsider.id, 'Hidden Project')
    const order = await seedOrder(hidden.id, ctx.nginx.id, ctx.vienna.id, outsider.id)
    await createInfraElement(order.id, hidden.id, ctx.vienna.id, ctx.nginx.id)
    await ctx.mk(ctx.postgres, ctx.frankfurt, ctx.webshop)

    const result = await listInfrastructureFacets(makeSession(ctx.pm))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.projects.map((p) => p.name)).toEqual(['Webshop Platform'])
    expect(result.data.environments.map((e) => e.name)).toEqual(['AWS Frankfurt'])

    const asAdmin = await listInfrastructureFacets(makeSession(ctx.admin))
    expect(asAdmin.ok && asAdmin.data.projects.map((p) => p.name)).toEqual([
      'Hidden Project', 'Webshop Platform',
    ])
  })

  it('returns empty lists when there is no infrastructure at all', async () => {
    const ctx = await searchable()
    const result = await listInfrastructureFacets(makeSession(ctx.admin))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({ environments: [], projects: [], products: [] })
  })
})

describe('decommissionInfra', () => {
  it('returns 404 for unknown infra', async () => {
    const { admin } = await setup()
    const result = await decommissionInfra(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 when decommissioning another user\'s project infra', async () => {
    const { otherPm, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await decommissionInfra(makeSession(otherPm), infra.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('returns 400 when infra status is not active', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
    })

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('admin can decommission any active infra; updates status, triggers webhook with destroy/INFRA_ID', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)
    mockedWebhooks.mockResolvedValueOnce({ pipelineIds: ['pipe-dc-1'], failures: [] })

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pipelineIds).toEqual(['pipe-dc-1'])

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    expect(dbInfra.status).toBe('decommissioning')
    expect(dbInfra.pipelineId).toEqual(['pipe-dc-1'])

    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
    const [pid, eid, vars] = mockedWebhooks.mock.calls[0]
    expect(pid).toBe(product.id)
    expect(eid).toBe(env.id)
    expect(vars).toMatchObject({ TF_ACTION: 'destroy', INFRA_ID: String(infra.id) })
  })

  it('also triggers pipeline-stack destroy and aggregates the returned pipeline ids', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)
    mockedWebhooks.mockResolvedValueOnce({ pipelineIds: ['pipe-wh'], failures: [] })
    mockedStacks.mockResolvedValueOnce({ pipelineIds: ['pipe-stack'], failures: [] })

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pipelineIds).toEqual(['pipe-wh', 'pipe-stack'])

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    expect(dbInfra.pipelineId).toEqual(['pipe-wh', 'pipe-stack'])

    expect(mockedStacks).toHaveBeenCalledTimes(1)
    const [pid, eid, vars] = mockedStacks.mock.calls[0]
    expect(pid).toBe(product.id)
    expect(eid).toBe(env.id)
    expect(vars).toMatchObject({ TF_ACTION: 'destroy', INFRA_ID: String(infra.id) })
  })

  it('PM can decommission their own project\'s active infra', async () => {
    const { pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await decommissionInfra(makeSession(pm), infra.id)
    expect(result.ok).toBe(true)

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    expect(dbInfra.status).toBe('decommissioning')
  })

  it('hands the element back to active and reports an error when NO destroy pipeline could be started', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)
    mockedWebhooks.mockResolvedValueOnce({ pipelineIds: [], failures: ['product webhook "wh" (#1): boom'] })
    mockedStacks.mockResolvedValueOnce({ pipelineIds: [], failures: [] })

    const result = await decommissionInfra(makeSession(admin), infra.id)
    // Nothing was destroyed, so this must not read as a started decommission.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
      expect(result.message).toContain('boom')
    }

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    // Back to active so the operator can retry.
    expect(dbInfra.status).toBe('active')
  })

  it('reports a partial destroy and records a sentinel so the teardown cannot self-complete', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)
    mockedWebhooks.mockResolvedValueOnce({ pipelineIds: ['pipe-wh'], failures: [] })
    mockedStacks.mockResolvedValueOnce({ pipelineIds: [], failures: ['pipeline stack "s" (#7): refused'] })

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
      expect(result.message).toContain('refused')
    }

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    // The webhook destroy IS running, so the element cannot go back to active.
    expect(dbInfra.status).toBe('decommissioning')
    expect(dbInfra.pipelineId).toEqual(['pipe-wh'])
    // The sentinel is what stops pipe-wh's success from reporting a complete
    // teardown while the stack was never destroyed.
    expect(dbInfra.pipelineStatus).toEqual({
      'trigger-failed:0': 'pipeline stack "s" (#7): refused',
    })
  })

  it('starts a clean decommission with an empty pipeline-status map', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(true)

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    expect(dbInfra.pipelineStatus).toEqual({})
  })
})
