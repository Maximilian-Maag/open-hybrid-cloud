import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci', () => ({
  listFiles: vi.fn(),
  getFileContent: vi.fn(),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, createCategory, createProduct, createCiSource, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { parameters, auditLog } from '@/lib/db/schema'
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
