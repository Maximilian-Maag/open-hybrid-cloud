import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci', () => ({
  listFiles: vi.fn(),
  getFileContent: vi.fn(),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { parameters, auditLog, pipelineStacks } from '@/lib/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { listFiles, getFileContent } from '@/lib/ci'

/**
 * Importing a product's parameters straight from a repository path.
 *
 * The sibling `sync-parameters` derives the repository, the ref and the path
 * from a pipeline stack, which is why it cannot run before one exists (#248) and
 * why it always reads `main`. This route is told where to look.
 */

const listMock = vi.mocked(listFiles)
const contentMock = vi.mocked(getFileContent)

function repo(files: Record<string, string>) {
  listMock.mockImplementation(async (_s, _p, _r, path) => {
    const prefix = path ? `${path}/` : ''
    return Object.keys(files)
      .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
      .map((f) => ({ name: f.slice(prefix.length), path: f, type: 'blob' as const }))
  })
  contentMock.mockImplementation(async (_s, _p, _r, file) => {
    const found = files[file as string]
    if (found === undefined) throw new Error(`404 ${file}`)
    return found
  })
}

const makeReq = (productId: number, body: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/import-parameters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  })

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })

async function setup() {
  const root = await createUser({ role: 'root' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  return { root, product, ci, auth: await makeAuthHeader(root) }
}

beforeEach(() => {
  listMock.mockReset()
  contentMock.mockReset()
})

describe('POST /api/admin/products/[id]/import-parameters', () => {
  it('creates a parameter for each variable it finds', async () => {
    const { product, ci, auth } = await setup()
    repo({ 'templates/vm/variables.tf': 'variable "hostname" { type = string }' })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ created: 1, createdNames: ['hostname'] })
    const rows = await db
      .select()
      .from(parameters)
      .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, product.id)))
    expect(rows.map((r) => r.name)).toEqual(['hostname'])
  })

  // The reported case: a template that only wires modules together.
  it('finds the variables of the modules a template composes', async () => {
    const { product, ci, auth } = await setup()
    repo({
      'templates/vm/main.tf': 'module "compute" { source = "../../modules/compute" }',
      'modules/compute/variables.tf': 'variable "instance_type" { type = string }',
    })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(await res.json()).toMatchObject({ created: 1, createdNames: ['instance_type'] })
  })

  it('reads the ref it is given rather than main', async () => {
    const { product, ci, auth } = await setup()
    repo({ 'templates/vm/variables.tf': 'variable "x" { type = string }' })

    await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '7', ref: 'feature/new-size', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(listMock).toHaveBeenCalledWith(expect.anything(), '7', 'feature/new-size', 'templates/vm')
  })

  // An admin who edited a label or narrowed a type made a decision; a re-import
  // is a request to pick up what is new, not to undo that.
  it('leaves an existing parameter alone and counts it as skipped', async () => {
    const { product, ci, auth } = await setup()
    await db.insert(parameters).values({
      scope: 'product', scopeId: product.id, name: 'hostname',
      label: 'Edited by hand', type: 'string', description: '', defaultValue: '', required: true, sensitive: false,
    })
    repo({ 'templates/vm/variables.tf': 'variable "hostname" { type = string }' })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(await res.json()).toMatchObject({ created: 0, skipped: 1 })
    const [row] = await db.select().from(parameters).where(eq(parameters.scopeId, product.id))
    expect(row.label).toBe('Edited by hand')
  })

  // #183: a template declaring `variable "ref"` must not produce a definition
  // letting the ordering user choose the git ref.
  it('never imports a name the server owns', async () => {
    const { product, ci, auth } = await setup()
    repo({
      'templates/vm/variables.tf': `
        variable "ref" { type = string }
        variable "tf_action" { type = string }
        variable "ci_api_url" { type = string }
        variable "hostname" { type = string }
      `,
    })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(await res.json()).toMatchObject({ createdNames: ['hostname'] })
  })

  it('does not import a sensitive variable', async () => {
    const { product, ci, auth } = await setup()
    repo({
      'templates/vm/variables.tf': `
        variable "api_key" { type = string sensitive = true }
        variable "hostname" { type = string }
      `,
    })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(await res.json()).toMatchObject({ createdNames: ['hostname'] })
  })

  // Names only, never values — a synced default can be a connection string.
  it('records the import in the audit log by name', async () => {
    const { root, product, ci, auth } = await setup()
    repo({ 'templates/vm/variables.tf': 'variable "hostname" { type = string default = "db.internal" }' })

    await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    const [entry] = await db
      .select().from(auditLog)
      .where(eq(auditLog.action, 'product.parameters_synced'))
      .orderBy(desc(auditLog.id)).limit(1)
    expect(entry.userId).toBe(root.id)
    expect(entry.details).toContain('hostname')
    expect(entry.details).not.toContain('db.internal')
  })

  it('tells the caller which modules it could not read', async () => {
    const { product, ci, auth } = await setup()
    repo({ 'templates/vm/main.tf': 'module "vpc" { source = "terraform-aws-modules/vpc/aws" }' })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    const body = await res.json()
    expect(body.created).toBe(0)
    expect(body.skippedModules).toEqual([expect.objectContaining({ module: 'vpc' })])
  })

  // Nothing found is not an error, and the files it read are how an operator
  // tells a wrong path from a template that declares nothing.
  it('answers 200 and names the files it read when it finds nothing', async () => {
    const { product, ci, auth } = await setup()
    repo({ 'templates/vm/main.tf': 'resource "x" "y" {}' })

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ created: 0, filesRead: ['templates/vm/main.tf'] })
  })

  it('answers 422 when the path cannot be read at that ref', async () => {
    const { product, ci, auth } = await setup()
    listMock.mockRejectedValue(new Error('404 Project Not Found'))

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'nope', path: 'templates/vm' }, auth),
      ctx(product.id),
    )

    expect(res.status).toBe(422)
  })

  // `parameters.scopeId` is polymorphic, so it carries no foreign key: without
  // the check the database accepts the write and a typo in the URL leaves orphan
  // rows behind a 200.
  /*
   * A product is provisioned by a webhook or a pipeline stack, per environment.
   * Importing the variables alone left it with neither — so it looked finished,
   * sat in the catalogue with a full order form, and answered 502 at the till.
   * That is exactly the state an imported Kubernetes product was found in.
   */
  describe('the pipeline stack', () => {
    const withEnvironment = async () => {
      const base = await setup()
      const env = await createEnvironment(base.ci.id)
      await linkProductEnvironment(base.product.id, env.id)
      return { ...base, env }
    }

    it('creates one from the imported path, so the product can be ordered', async () => {
      const { product, ci, env, auth } = await withEnvironment()
      repo({
        'templates/linode/kubernetes-cluster/variables.tf':
          'variable "cluster_label" { type = string description = "Unique cluster label — also used as the Terraform state key (TF_STATE_NAME)" }',
      })

      const res = await POST(
        makeReq(product.id, {
          ciSourceId: ci.id, projectId: '1', ref: 'main',
          path: 'templates/linode/kubernetes-cluster', environmentId: env.id,
        }, auth),
        ctx(product.id),
      )

      expect(res.status).toBe(200)
      expect((await res.json()).stack).toMatchObject({ created: true, template: 'linode/kubernetes-cluster' })

      const [stack] = await db.select().from(pipelineStacks).where(eq(pipelineStacks.productId, product.id))
      expect(stack.environmentId).toBe(env.id)
      // Read out of the variable's own description, not guessed.
      expect(stack.stateKeyParam).toBe('cluster_label')
      expect(stack.steps).toEqual([{ template: 'linode/kubernetes-cluster', stateSuffix: '-kubernetes-cluster' }])
    })

    // The fallback, and the majority case: every VM template names `hostname`.
    it('falls back to hostname when no variable claims the state key', async () => {
      const { product, ci, env, auth } = await withEnvironment()
      repo({ 'templates/aws/network/variables.tf': 'variable "cidr" { type = string }' })

      await POST(
        makeReq(product.id, {
          ciSourceId: ci.id, projectId: '1', ref: 'main',
          path: 'templates/aws/network', environmentId: env.id,
        }, auth),
        ctx(product.id),
      )

      const [stack] = await db.select().from(pipelineStacks).where(eq(pipelineStacks.productId, product.id))
      expect(stack.stateKeyParam).toBe('hostname')
    })

    // A re-import picks up new VARIABLES. It does not flatten an arrangement of
    // steps somebody built by hand.
    /*
     * Rewritten for #288. This asserted `already-configured` for a stack whose
     * steps have NOTHING to do with the imported template — which is the bug:
     * "kept" was the only thing a second import could say, whether the stack
     * matched or not, so an operator correcting a path was reassured and
     * nothing changed.
     *
     * The half of it that was right is kept and made explicit: the stack is
     * still not overwritten. Its steps decide the Terraform state key each
     * element is stood up under, and existing infrastructure was applied
     * against the old one.
     */
    it('reports a stack that runs something else, and still does not touch it', async () => {
      const { product, ci, env, auth } = await withEnvironment()
      await db.insert(pipelineStacks).values({
        productId: product.id, environmentId: env.id, name: 'Hand-built',
        stateKeyParam: 'hostname',
        steps: [{ template: 'linode/virtual-machine', stateSuffix: '-vm' }, { template: 'linode/block-storage', stateSuffix: '-disk' }],
      })
      repo({ 'templates/linode/kubernetes-cluster/variables.tf': 'variable "cluster_label" { type = string }' })

      const res = await POST(
        makeReq(product.id, {
          ciSourceId: ci.id, projectId: '1', ref: 'main',
          path: 'templates/linode/kubernetes-cluster', environmentId: env.id,
        }, auth),
        ctx(product.id),
      )

      expect((await res.json()).stack).toMatchObject({
        created: false,
        reason: 'points-elsewhere',
        name: 'Hand-built',
        // Both sides named, because "kept" without them is indistinguishable
        // from "already right".
        existingTemplates: ['linode/virtual-machine', 'linode/block-storage'],
        importedTemplate: 'linode/kubernetes-cluster',
      })
      const rows = await db.select().from(pipelineStacks).where(eq(pipelineStacks.productId, product.id))
      expect(rows).toHaveLength(1)
      expect(rows[0].steps).toHaveLength(2)
    })

    it('says already-configured when the stack does run the imported template', async () => {
      const { product, ci, env, auth } = await withEnvironment()
      await db.insert(pipelineStacks).values({
        productId: product.id, environmentId: env.id, name: 'linode/kubernetes-cluster',
        stateKeyParam: 'cluster_label',
        steps: [{ template: 'linode/kubernetes-cluster', stateSuffix: '-lke' }],
      })
      repo({ 'templates/linode/kubernetes-cluster/variables.tf': 'variable "cluster_label" { type = string }' })

      const res = await POST(
        makeReq(product.id, {
          ciSourceId: ci.id, projectId: '1', ref: 'main',
          path: 'templates/linode/kubernetes-cluster', environmentId: env.id,
        }, auth),
        ctx(product.id),
      )

      expect((await res.json()).stack).toMatchObject({ created: false, reason: 'already-configured' })
    })

    it('imports the variables and no stack when no environment is named', async () => {
      const { product, ci, auth } = await withEnvironment()
      repo({ 'templates/linode/kubernetes-cluster/variables.tf': 'variable "cluster_label" { type = string }' })

      const res = await POST(
        makeReq(product.id, {
          ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/linode/kubernetes-cluster',
        }, auth),
        ctx(product.id),
      )

      const body = await res.json()
      expect(body.created).toBe(1)
      // Absent, not null: no environment was named, so no stack was attempted.
      expect(body).not.toHaveProperty('stack')
      expect(await db.select().from(pipelineStacks).where(eq(pipelineStacks.productId, product.id))).toEqual([])
    })

    it('records the stack in the audit log', async () => {
      const { product, ci, env, auth } = await withEnvironment()
      repo({ 'templates/linode/kubernetes-cluster/variables.tf': 'variable "cluster_label" { type = string }' })

      await POST(
        makeReq(product.id, {
          ciSourceId: ci.id, projectId: '1', ref: 'main',
          path: 'templates/linode/kubernetes-cluster', environmentId: env.id,
        }, auth),
        ctx(product.id),
      )

      const [entry] = await db.select().from(auditLog)
        .where(eq(auditLog.action, 'product.pipeline_stack_created'))
        .orderBy(desc(auditLog.id)).limit(1)
      expect(entry.details).toContain('linode/kubernetes-cluster')
    })
  })

  it('answers 404 for a product that is not there, and writes nothing', async () => {
    const { ci, auth } = await setup()
    repo({ 'templates/vm/variables.tf': 'variable "hostname" { type = string }' })

    const res = await POST(
      makeReq(999_999, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'templates/vm' }, auth),
      ctx(999_999),
    )

    expect(res.status).toBe(404)
    const rows = await db.select().from(parameters).where(eq(parameters.scopeId, 999_999))
    expect(rows).toEqual([])
    // It did not even reach the repository.
    expect(listMock).not.toHaveBeenCalled()
  })

  it('answers 404 for a CI source that is not there', async () => {
    const { product, auth } = await setup()

    const res = await POST(
      makeReq(product.id, { ciSourceId: 999_999, projectId: '1', ref: 'main', path: 'x' }, auth),
      ctx(product.id),
    )

    expect(res.status).toBe(404)
  })

  it('rejects a body that is missing the coordinates', async () => {
    const { product, auth } = await setup()

    const res = await POST(makeReq(product.id, { ref: 'main' }, auth), ctx(product.id))

    expect(res.status).toBe(400)
  })

  it('refuses anyone who is not root', async () => {
    const admin = await createUser({ role: 'admin' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'x' }, await makeAuthHeader(admin)),
      ctx(product.id),
    )

    expect(res.status).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const { product, ci } = await setup()

    const res = await POST(
      makeReq(product.id, { ciSourceId: ci.id, projectId: '1', ref: 'main', path: 'x' }),
      ctx(product.id),
    )

    expect(res.status).toBe(401)
  })
})
