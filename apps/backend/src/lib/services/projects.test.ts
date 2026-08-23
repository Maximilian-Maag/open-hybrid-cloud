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

import { listProjects, getProjectById, createProject, updateProject, deleteProject } from './projects'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { projects, infrastructureElements, orders, orderComments, auditLog } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createProject as seedProject,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createOrder as seedOrder,
  createInfraElement,
  waitUntilBlocked,
  warmPool,
  latch,
} from '@/test/helpers'

const mockedWebhooks = vi.mocked(triggerProductWebhooksTracked)
const mockedStacks = vi.mocked(triggerPipelineStacksTracked)

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue({ pipelineIds: ['pipe-destroy'], failures: [] })
  mockedStacks.mockReset().mockResolvedValue({ pipelineIds: [], failures: [] })
})

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

describe('listProjects', () => {
  it('admin sees all projects', async () => {
    const admin = await createUser({ role: 'admin', email: 'a@test.dev' })
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    await seedProject(pm1.id)
    await seedProject(pm2.id)

    const result = await listProjects(makeSession(admin))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(2)
  })

  it('PM sees only their own projects', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const own = await seedProject(pm1.id)
    await seedProject(pm2.id)

    const result = await listProjects(makeSession(pm1))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].id).toBe(own.id)
    }
  })
})

describe('getProjectById', () => {
  it('returns 404 for unknown project', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await getProjectById(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 for another user\'s project', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const p = await seedProject(pm2.id)

    const result = await getProjectById(makeSession(pm1), p.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('admin can see any project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const p = await seedProject(pm.id)

    const result = await getProjectById(makeSession(admin), p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe(p.id)
  })
})

describe('createProject', () => {
  it('creates project with session.id as ownerId', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const result = await createProject(makeSession(pm), {
      name: 'My Proj',
      description: 'desc',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('My Proj')
      expect(result.data.ownerId).toBe(pm.id)
      expect(result.data.description).toBe('desc')
    }
  })
})

describe('updateProject', () => {
  it('returns 404 for unknown project', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await updateProject(makeSession(admin), 999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 for another user\'s project', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const p = await seedProject(pm2.id)

    const result = await updateProject(makeSession(pm1), p.id, { name: 'Hijacked' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('admin can update any project, updating name and description', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const p = await seedProject(pm.id)

    const result = await updateProject(makeSession(admin), p.id, {
      name: 'Updated',
      description: 'New desc',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Updated')
      expect(result.data.description).toBe('New desc')
    }

    const [dbProj] = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(dbProj.name).toBe('Updated')
    expect(dbProj.description).toBe('New desc')
  })
})

describe('deleteProject', () => {
  it('returns 404 for unknown project', async () => {
    const admin = await createUser({ role: 'admin' })
    const result = await deleteProject(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 when deleting another PM\'s project', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const p = await seedProject(pm2.id)

    const result = await deleteProject(makeSession(pm1), p.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('deletes the project from DB and returns ok(undefined)', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const p = await seedProject(pm.id)

    const result = await deleteProject(makeSession(admin), p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBeUndefined()

    const rows = await db.select().from(projects).where(eq(projects.id, p.id))
    expect(rows.length).toBe(0)
  })

  // FA-09.5: cascade decommissioning on project delete
  it('cascade-decommissions all active infra elements of the project (FA-09.5)', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id)
    await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await deleteProject(makeSession(admin), project.id)
    expect(result.ok).toBe(true)

    // Destroy webhook fired for every active element
    expect(mockedWebhooks).toHaveBeenCalledTimes(2)
    expect(mockedWebhooks).toHaveBeenCalledWith(
      product.id,
      env.id,
      expect.objectContaining({ TF_ACTION: 'destroy' }),
    )
    // Pipeline-stack destroy fired for every active element too, so stack-
    // provisioned infra is not leaked on project deletion.
    expect(mockedStacks).toHaveBeenCalledTimes(2)
    expect(mockedStacks).toHaveBeenCalledWith(
      product.id,
      env.id,
      expect.objectContaining({ TF_ACTION: 'destroy' }),
    )
    // The elements are claimed and left for their destroy pipelines to reconcile.
    // The old cascade deleted them here, which is what left running infrastructure
    // with nothing to reconcile the callback against.
    const rows = await db.select().from(infrastructureElements).where(eq(infrastructureElements.projectId, project.id))
    expect(rows.map((r) => r.status)).toEqual(['decommissioning', 'decommissioning'])
  })

  // FA-09.8: already-decommissioning / decommissioned elements are skipped
  it('skips infra elements already in decommissioning/decommissioned status (FA-09.8)', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'decommissioning' })
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'decommissioned' })
    await createInfraElement(order.id, project.id, env.id, product.id, { status: 'active' })

    const result = await deleteProject(makeSession(admin), project.id)
    expect(result.ok).toBe(true)

    // Only the active element triggers a destroy webhook — the two already-in-flight are skipped
    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
    expect(mockedWebhooks).toHaveBeenCalledWith(
      product.id,
      env.id,
      expect.objectContaining({ TF_ACTION: 'destroy' }),
    )
    expect(mockedStacks).toHaveBeenCalledTimes(1)
  })

  // Cascade-delete race: the destroy trigger must complete BEFORE the project
  // (and its cascaded infra rows) are deleted.
  it('awaits the destroy trigger before touching the project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id)

    // At the moment the trigger fires, the project and its infra must still
    // exist (i.e. the delete has NOT run yet).
    let projectExistedAtTrigger = false
    let infraExistedAtTrigger = false
    mockedWebhooks.mockImplementationOnce(async () => {
      projectExistedAtTrigger =
        (await db.select().from(projects).where(eq(projects.id, project.id))).length > 0
      infraExistedAtTrigger =
        (await db.select().from(infrastructureElements).where(eq(infrastructureElements.projectId, project.id))).length > 0
      return { pipelineIds: ['pipe-destroy'], failures: [] }
    })

    const result = await deleteProject(makeSession(admin), project.id)
    expect(result.ok).toBe(true)

    expect(projectExistedAtTrigger).toBe(true)
    expect(infraExistedAtTrigger).toBe(true)

    // And afterwards the project is gone from every read. The row survives because
    // the project has an order — see the retirement tests below.
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
    expect(row.retiredAt).not.toBeNull()
    const listed = await listProjects(makeSession(admin))
    expect(listed.ok && listed.data).toHaveLength(0)
  })

  it('refuses to delete the project when a destroy trigger could not be started', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin2@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id)
    mockedStacks.mockResolvedValueOnce({ pipelineIds: [], failures: ['pipeline stack "s" (#3): refused'] })

    const result = await deleteProject(makeSession(admin), project.id)
    // The cascade would remove the infrastructure_elements rows and leave the
    // provisioned infrastructure running untracked.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
      expect(result.message).toContain('refused')
    }

    const rows = await db.select().from(projects).where(eq(projects.id, project.id))
    expect(rows.length).toBe(1)
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.projectId, project.id))
    expect(infra.length).toBe(1)
  })

  // Issue #187. `orders.project_id` is ON DELETE CASCADE and `order_comments`
  // cascades from there, so this is the test that would have caught the loss: seed
  // an order into the project and assert it SURVIVES the delete.
  it('keeps the orders, their comments and their snapshots, and retires the project instead', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    const order = await seedOrder(project.id, product.id, env.id, pm.id, {
      status: 'completed',
      productSnapshot: {
        version: 1,
        capturedAt: '2026-01-01T00:00:00.000Z',
        productName: 'Nginx Gateway',
        productDescription: '',
        environmentName: 'AWS Frankfurt',
        price: '300.00',
        currency: 'EUR',
        parameters: [],
        costCenterMode: 'project',
        forcedCostCenter: false,
        trialEnabled: false,
        trialDurationMinutes: 30,
      },
    })
    await db.insert(orderComments).values({ orderId: order.id, userId: pm.id, body: 'signed off by finance' })

    const result = await deleteProject(makeSession(admin), project.id)
    expect(result.ok).toBe(true)

    // The spend the dashboard, the CSV and the PDF all read FROM orders.
    const [kept] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(kept).toBeDefined()
    expect(kept.productSnapshot?.price).toBe('300.00')
    expect(await db.select().from(orderComments).where(eq(orderComments.orderId, order.id))).toHaveLength(1)

    // And the project is gone everywhere anybody can see it.
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
    expect(row.retiredAt).not.toBeNull()
    const listed = await listProjects(makeSession(admin))
    expect(listed.ok && listed.data).toHaveLength(0)
    const fetched = await getProjectById(makeSession(admin), project.id)
    expect(fetched.ok).toBe(false)
    if (!fetched.ok) expect(fetched.status).toBe(404)
  })

  it('still hard-deletes a project that never had an order', async () => {
    // Retirement is for history worth keeping; an empty project has none.
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const project = await seedProject(pm.id)

    expect((await deleteProject(makeSession(admin), project.id)).ok).toBe(true)
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(0)
  })

  it('refuses a second delete of a retired project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    await seedOrder(project.id, product.id, env.id, pm.id)

    expect((await deleteProject(makeSession(admin), project.id)).ok).toBe(true)
    const again = await deleteProject(makeSession(admin), project.id)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.status).toBe(404)
  })

  it('counts an order that commits during the destroy triggers, and keeps it', async () => {
    // The count has to happen inside the transaction that performs the delete: the
    // destroy triggers above are network calls that take seconds, and the project
    // stays fully orderable throughout them. Held deterministically rather than
    // raced — the holder stands in for an order landing in that window.
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await seedProject(pm.id)
    await warmPool()

    const held = latch()
    const holder = db.transaction(async (tx) => {
      // An order insert takes FOR KEY SHARE on the project it references, which is
      // what the delete's FOR UPDATE has to wait behind.
      await tx.insert(orders).values({
        projectId: project.id,
        productId: product.id,
        environmentId: env.id,
        userId: pm.id,
        status: 'completed',
      })
      held.open()
      await waitUntilBlocked('the delete never claimed the project row')
    })
    await held.opened

    const [result] = await Promise.all([deleteProject(makeSession(admin), project.id), holder])
    expect(result.ok).toBe(true)

    // Counted, so the project was retired — and the order it was counted for is
    // still there. Under the cascade it was deleted the moment the holder committed.
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
    expect(row.retiredAt).not.toBeNull()
    expect(await db.select().from(orders).where(eq(orders.projectId, project.id))).toHaveLength(1)
  })

  it('audits the retirement and the delete', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const withOrders = await seedProject(pm.id, 'Has history')
    await seedOrder(withOrders.id, product.id, env.id, pm.id)
    const empty = await seedProject(pm.id, 'Empty')

    await deleteProject(makeSession(admin), withOrders.id)
    await deleteProject(makeSession(admin), empty.id)

    const entries = await db.select().from(auditLog)
    const retired = entries.find((e) => e.action === 'project.retired')
    expect(retired?.entityId).toBe(withOrders.id)
    expect(retired?.userId).toBe(admin.id)
    expect(retired?.details).toMatch(/1 order/)
    expect(entries.find((e) => e.action === 'project.deleted')?.entityId).toBe(empty.id)
  })
})

// The most destructive operation in the system wrote nothing to the append-only
// log: #137 audited services/admin/, and projects live a directory up (issue #187).
describe('project auditing', () => {
  it('audits a create', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const created = await createProject(makeSession(pm), { name: 'Audited' })
    expect(created.ok).toBe(true)

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'project.created'))
    expect(entry.userId).toBe(pm.id)
    if (created.ok) expect(entry.entityId).toBe(created.data.id)
  })

  it('audits an update by field name and never by value', async () => {
    // The policy on logAudit: this table is append-only, so a value written here
    // can never be redacted again.
    const pm = await createUser({ role: 'project_manager' })
    const project = await seedProject(pm.id)
    await updateProject(makeSession(pm), project.id, { name: 'Renamed', description: 'why' })

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'project.updated'))
    expect(entry.entityId).toBe(project.id)
    expect(entry.details).toBe('Changed: description, name')
    expect(entry.details).not.toMatch(/Renamed/)
  })
})
