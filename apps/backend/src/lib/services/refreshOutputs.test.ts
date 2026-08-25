import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { infrastructureElements } from '@/lib/db/schema'
import type { SessionUser } from '@open-hybrid-cloud/types'
import {
  createUser, createCategory, createProduct, createCiSource,
  createEnvironment, createProject, createOrder, createInfraElement,
} from '@/test/helpers'

const fetchJobTraces = vi.fn()
vi.mock('@/lib/ci', () => ({
  fetchJobTraces: (...a: unknown[]) => fetchJobTraces(...a),
  parseTofuOutputs: (t: string) =>
    Object.fromEntries(
      t.split('\n').filter((l) => l.includes(' = ')).map((l) => {
        const [k, v] = l.split(' = ')
        return [k.trim(), v.trim().replace(/^"|"$/g, '')]
      }),
    ),
  supportsJobTrace: () => true,
}))

const { refreshElementOutputs, refreshOutputsLimit } = await import('./infrastructure')

const session = (u: { id: number; role: string }): SessionUser =>
  ({ id: u.id, email: 'x@test.dev', name: 'X', role: u.role }) as SessionUser

const scenario = async () => {
  const admin = await createUser({ role: 'admin' })
  const pm = await createUser({ role: 'project_manager' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await createOrder(project.id, product.id, env.id, pm.id)
  const el = await createInfraElement(order.id, project.id, env.id, product.id, {
    pipelineId: ['777'],
  })
  return { admin, pm, project, el }
}

beforeEach(() => {
  fetchJobTraces.mockReset()
  // Element ids repeat across cases in a truncated database, so without this
  // one case's element is still inside the next case's refresh cooldown.
  refreshOutputsLimit.clear()
})

/**
 * Issue #218. Outputs are parsed once, at settle. When something was wrong at
 * that instant the element was blank forever, and the only remedies were a
 * database script or redeploying real infrastructure to get a second read of a
 * log that had not changed.
 */
describe('refreshElementOutputs', () => {
  it('reads the outputs and stores them', async () => {
    const { admin, el } = await scenario()
    fetchJobTraces.mockResolvedValue(['Outputs:\nip_address = "172.105.94.94"'])

    const result = await refreshElementOutputs(session(admin), el.id)
    expect(result.ok).toBe(true)

    const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, el.id))
    expect(row.outputs).toEqual({ ip_address: '172.105.94.94' })
    expect(row.outputsError).toBeNull()
  })

  it('records why, when the log cannot be read', async () => {
    // The hcp-dev case: an expired CI token. Blank and "your token died" must not
    // be the same screen.
    const { admin, el } = await scenario()
    fetchJobTraces.mockRejectedValue(new Error('GitLab jobs fetch failed: 401'))

    const result = await refreshElementOutputs(session(admin), el.id)
    expect(result.ok).toBe(true)

    const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, el.id))
    expect(row.outputsError).toMatch(/401/)
    expect(row.outputsError).toMatch(/access token/i)
  })

  it('says the deployment declared none, when the log reads fine and has no block', async () => {
    const { admin, el } = await scenario()
    fetchJobTraces.mockResolvedValue(['Apply complete! Resources: 0 added.'])

    await refreshElementOutputs(session(admin), el.id)
    const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, el.id))
    expect(row.outputsError).toMatch(/declared none/i)
  })

  it('clears a previous complaint once the read succeeds', async () => {
    // The whole point: fix the token, press the button, and the page stops
    // accusing it.
    const { admin, el } = await scenario()
    fetchJobTraces.mockRejectedValueOnce(new Error('GitLab jobs fetch failed: 401'))
    await refreshElementOutputs(session(admin), el.id)

    // Past the 15s cooldown, which these two calls are not about.
    refreshOutputsLimit.clear()
    fetchJobTraces.mockResolvedValue(['Outputs:\nip_address = "10.0.0.1"'])
    await refreshElementOutputs(session(admin), el.id)

    const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, el.id))
    expect(row.outputs).toEqual({ ip_address: '10.0.0.1' })
    expect(row.outputsError).toBeNull()
  })

  it('does not erase outputs it already had when a later read fails', async () => {
    // A transient CI outage must not take the endpoint off the page.
    const { admin, el } = await scenario()
    fetchJobTraces.mockResolvedValueOnce(['Outputs:\nip_address = "10.0.0.1"'])
    await refreshElementOutputs(session(admin), el.id)

    // Past the 15s cooldown, which these two calls are not about.
    refreshOutputsLimit.clear()
    fetchJobTraces.mockRejectedValue(new Error('GitLab jobs fetch failed: 502'))
    await refreshElementOutputs(session(admin), el.id)

    const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, el.id))
    expect(row.outputs).toEqual({ ip_address: '10.0.0.1' })
    expect(row.outputsError).toMatch(/502/)
  })

  // Each call makes one outbound CI request per pipeline the element has,
  // against the token the settle path shares. Without a cooldown, holding the
  // button down amplifies one click into an unbounded stream of API calls and
  // can exhaust that token for the whole environment.
  it('refuses a second re-read of the same element inside the cooldown', async () => {
    const { admin, el } = await scenario()
    fetchJobTraces.mockResolvedValue(['Outputs:\nip_address = "10.0.0.1"'])

    const first = await refreshElementOutputs(session(admin), el.id)
    expect(first.ok).toBe(true)

    const second = await refreshElementOutputs(session(admin), el.id)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.status).toBe(429)
    // The point of the cooldown: the second click cost no outbound traffic.
    expect(fetchJobTraces).toHaveBeenCalledTimes(1)
  })

  it('throttles per element, so one element does not block another', async () => {
    const { admin, el } = await scenario()
    const other = await scenario()
    fetchJobTraces.mockResolvedValue(['Outputs:\nip_address = "10.0.0.1"'])

    expect((await refreshElementOutputs(session(admin), el.id)).ok).toBe(true)
    expect((await refreshElementOutputs(session(other.admin), other.el.id)).ok).toBe(true)
  })

  // The cooldown sits behind the scoping check on purpose: if it came first, a
  // caller who may not see an element could spend its budget and deny the
  // refresh to the people who own it.
  it('does not let a caller who cannot see the element spend its cooldown', async () => {
    const { el } = await scenario()
    const stranger = await scenario()
    fetchJobTraces.mockResolvedValue(['Outputs:\nip_address = "10.0.0.1"'])

    const denied = await refreshElementOutputs(session(stranger.pm), el.id)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.status).toBe(404)

    // The owner's first click still works.
    expect((await refreshElementOutputs(session(stranger.admin), el.id)).ok).toBe(true)
  })

  it('lets the project manager who owns it refresh their own element', async () => {
    // Reading a log starts nothing and changes no infrastructure, unlike retry.
    const { pm, el } = await scenario()
    fetchJobTraces.mockResolvedValue(['Outputs:\nip_address = "10.0.0.2"'])
    expect((await refreshElementOutputs(session(pm), el.id)).ok).toBe(true)
  })

  it('answers 404 to a project manager who does not own it', async () => {
    // 404 and not 403: that the element exists is itself information.
    const { el } = await scenario()
    const other = await createUser({ role: 'project_manager', email: 'other-pm@test.dev' })
    const result = await refreshElementOutputs(session(other), el.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
    expect(fetchJobTraces).not.toHaveBeenCalled()
  })

  it('answers 404 for an element that does not exist', async () => {
    const { admin } = await scenario()
    const result = await refreshElementOutputs(session(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('explains rather than throwing when the element has no pipeline', async () => {
    const { admin, el } = await scenario()
    await db.update(infrastructureElements).set({ pipelineId: [] }).where(eq(infrastructureElements.id, el.id))

    const result = await refreshElementOutputs(session(admin), el.id)
    expect(result.ok).toBe(true)
    const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, el.id))
    expect(row.outputsError).toMatch(/no pipeline/i)
    expect(fetchJobTraces).not.toHaveBeenCalled()
  })
})
