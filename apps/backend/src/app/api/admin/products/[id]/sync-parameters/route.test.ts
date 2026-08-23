import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ci', () => ({
  getFileContent: vi.fn().mockResolvedValue(''),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, createCategory, createProduct, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { pipelineStacks, parameters } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getFileContent } from '@/lib/ci'
import type { StackStep } from '@open-hybrid-cloud/types'

const HCL_CONTENT = `
variable "hostname" {
  type        = string
  description = "The server hostname"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "ci_api_url" {
  type = string
}
`

const makeReq = (productId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/sync-parameters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const seedStack = async (overrides?: { steps?: StackStep[] }) => {
  const cat = await createCategory()
  const p = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const [stack] = await db.insert(pipelineStacks).values({
    productId: p.id,
    environmentId: env.id,
    name: 'Test Stack',
    stateKeyParam: 'hostname',
    steps: overrides?.steps ?? [{ template: 'linode/virtual-machine', stateSuffix: '-vm' }],
  }).returning()
  return { p, env, stack, ci }
}

describe('POST /api/admin/products/[id]/sync-parameters', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('1', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager role', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('1', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 422 when product has no pipeline stack', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(422)
  })

  it('returns 422 when pipeline stack has no steps', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack({ steps: [] })
    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(422)
  })

  it('returns 422 when getFileContent throws', async () => {
    vi.mocked(getFileContent).mockRejectedValueOnce(new Error('not found'))
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack()
    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(422)
  })

  it('creates parameters from HCL and returns { created: 2, skipped: 0 }', async () => {
    vi.mocked(getFileContent).mockResolvedValueOnce(HCL_CONTENT)
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack()
    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ created: 2, skipped: 0 })
  })

  it('does not import a Terraform variable named after a CI variable the server sets (issue #183)', async () => {
    // This route is why #183 needed nobody to type a dangerous name: it creates
    // one parameter definition per Terraform variable, and a definition named
    // `ref` or `tf_action` is what let the ordering user pick the git ref the
    // pipeline ran, or make a provisioning order destroy instead.
    vi.mocked(getFileContent).mockResolvedValueOnce(`
variable "hostname" {
  type = string
}

variable "ref" {
  type    = string
  default = "main"
}

variable "tf_action" {
  type    = string
  default = "apply"
}
`)
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack()

    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)

    const rows = await db
      .select()
      .from(parameters)
      .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, p.id)))
    expect(rows.map((r) => r.name)).toEqual(['hostname'])
  })

  it('skips parameters that already exist on second call', async () => {
    vi.mocked(getFileContent).mockResolvedValue(HCL_CONTENT)
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack()

    const firstRes = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(firstRes.status).toBe(200)
    expect(await firstRes.json()).toEqual({ created: 2, skipped: 0 })

    const secondRes = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(secondRes.status).toBe(200)
    expect(await secondRes.json()).toEqual({ created: 0, skipped: 2 })
  })

  it('classifies numeric/bool defaults as optional and handles nested validation braces', async () => {
    // A weaker regex parser would (a) miss `default = 3` / `default = true`
    // because it only matches string defaults, importing them as required, and
    // (b) mis-scope the variable body at the first inner `}` of a validation
    // block. The canonical parser must get both right.
    const HCL = `
variable "instance_count" {
  type    = number
  default = 3
}

variable "enabled" {
  type    = bool
  default = true
}

variable "size" {
  type = string
  validation {
    condition     = contains(["s", "m", "l"], var.size)
    error_message = "size must be s, m or l."
  }
}

variable "hostname" {
  type = string
}
`
    vi.mocked(getFileContent).mockResolvedValueOnce(HCL)
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack()

    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ created: 4, skipped: 0 })

    const rows = await db
      .select({ name: parameters.name, type: parameters.type, required: parameters.required, defaultValue: parameters.defaultValue })
      .from(parameters)
      .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, p.id)))
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

    // Numeric default → optional, default preserved.
    expect(byName['instance_count'].required).toBe(false)
    expect(byName['instance_count'].type).toBe('number')
    expect(byName['instance_count'].defaultValue).toBe('3')

    // Bool default → optional.
    expect(byName['enabled'].required).toBe(false)
    expect(byName['enabled'].type).toBe('bool')
    expect(byName['enabled'].defaultValue).toBe('true')

    // Validation block (no default) → still required; body not truncated at the
    // inner brace (the trailing hostname var is still parsed).
    expect(byName['size'].required).toBe(true)
    expect(byName['hostname'].required).toBe(true)
  })

  it('auto-generates label from variable name', async () => {
    vi.mocked(getFileContent).mockResolvedValueOnce(HCL_CONTENT)
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const { p } = await seedStack()

    const res = await POST(makeReq(String(p.id), auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)

    const rows = await db
      .select({ name: parameters.name, label: parameters.label })
      .from(parameters)
      .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, p.id)))

    const byName = Object.fromEntries(rows.map((r) => [r.name, r.label]))
    expect(byName['hostname']).toBe('Hostname')
    expect(byName['region']).toBe('Region')
  })
})
