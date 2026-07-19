import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { pipelineStacks, parameters, ciSources, deploymentEnvironments } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getFileContent } from '@/lib/ci'
import type { CiProvider } from '@open-hybrid-cloud/types'

const CI_INTERNAL_VARS = new Set(['ci_api_url', 'ci_project_id', 'ci_job_token', 'vm_state_name'])

function parseHclVariables(content: string) {
  const results: Array<{
    name: string
    description: string
    defaultValue: string
    type: 'string' | 'number' | 'bool'
  }> = []

  const blockRegex = /variable\s+"([^"]+)"\s*\{([^}]*)\}/g
  let match
  while ((match = blockRegex.exec(content)) !== null) {
    const name = match[1]
    const body = match[2]

    if (/sensitive\s*=\s*true/.test(body)) continue
    if (CI_INTERNAL_VARS.has(name)) continue

    const description = body.match(/description\s*=\s*"([^"]*)"/)
    const defaultVal = body.match(/default\s*=\s*"([^"]*)"/)
    const typeMatch = body.match(/type\s*=\s*(string|number|bool)/)

    results.push({
      name,
      description: description?.[1] ?? '',
      defaultValue: defaultVal?.[1] ?? '',
      type: (typeMatch?.[1] ?? 'string') as 'string' | 'number' | 'bool',
    })
  }

  return results
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)

  const stacks = await db
    .select()
    .from(pipelineStacks)
    .where(eq(pipelineStacks.productId, productId))
    .limit(1)

  if (!stacks.length || !(stacks[0].steps as unknown[]).length) {
    return NextResponse.json(
      { error: 'No pipeline stack with steps found — add a pipeline stack first' },
      { status: 422 },
    )
  }

  const stack = stacks[0]
  const steps = stack.steps as Array<{ template: string }>
  const template = steps[0].template

  const projectIdMatch = stack.webhookUrl.match(/\/projects\/(\d+)\//)
  if (!projectIdMatch) {
    return NextResponse.json(
      { error: 'Could not extract project ID from pipeline stack webhook URL' },
      { status: 422 },
    )
  }
  const projectId = projectIdMatch[1]

  const envRows = await db
    .select({ ciSourceId: deploymentEnvironments.ciSourceId })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, stack.environmentId))
    .limit(1)

  if (!envRows.length) {
    return NextResponse.json({ error: 'Deployment environment not found' }, { status: 422 })
  }

  const ciSourceRows = await db
    .select()
    .from(ciSources)
    .where(eq(ciSources.id, envRows[0].ciSourceId))
    .limit(1)

  if (!ciSourceRows.length) {
    return NextResponse.json({ error: 'CI source not found' }, { status: 422 })
  }

  const src = ciSourceRows[0]

  let content: string
  try {
    content = await getFileContent(
      { url: src.url, accessToken: src.accessToken, provider: src.provider as CiProvider },
      projectId,
      'main',
      `templates/${template}/variables.tf`,
    )
  } catch {
    return NextResponse.json(
      { error: `Could not fetch templates/${template}/variables.tf from the CI source` },
      { status: 422 },
    )
  }

  const vars = parseHclVariables(content)

  const existing = await db
    .select({ name: parameters.name })
    .from(parameters)
    .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, productId)))

  const existingNames = new Set(existing.map((p) => p.name))

  let created = 0
  for (const v of vars) {
    if (existingNames.has(v.name)) continue
    const label = v.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: productId,
      name: v.name,
      label,
      type: v.type,
      description: v.description,
      defaultValue: v.defaultValue,
      required: v.defaultValue === '',
      sensitive: false,
    })
    created++
  }

  return NextResponse.json({ created, skipped: vars.length - created })
}
