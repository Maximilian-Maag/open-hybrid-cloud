import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { updatePipelineStack, deletePipelineStack } from '@/lib/services/admin/pipeline-stacks'

const UpstreamRefSchema = z.object({
  varName: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'must be UPPER_SNAKE_CASE CI variable name'),
  suffix: z.string().min(1),
})

const StackStepSchema = z.object({
  template: z.string().min(1),
  stateSuffix: z.string().min(1),
  execOrder: z.number().int().min(0).default(0),
  upstreamRefs: z.array(UpstreamRefSchema).optional(),
  fixedParams: z.record(z.string()).optional(),
})

const UpdateStackSchema = z.object({
  name: z.string().min(1).optional(),
  stateKeyParam: z.string().min(1).optional(),
  steps: z.array(StackStepSchema).min(1).optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stackId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, stackId } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpdateStackSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updatePipelineStack(parseInt(id, 10), parseInt(stackId, 10), parsed.data))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stackId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, stackId } = await params
  return toResponse(await deletePipelineStack(parseInt(id, 10), parseInt(stackId, 10)))
}
