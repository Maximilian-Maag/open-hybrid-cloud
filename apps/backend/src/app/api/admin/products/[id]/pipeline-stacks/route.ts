import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listPipelineStacks, createPipelineStack } from '@/lib/services/admin/pipeline-stacks'

const StackStepSchema = z.object({
  template: z.string().min(1),
  stateSuffix: z.string().min(1),
  upstreamSuffix: z.string().optional(),
  fixedParams: z.record(z.string()).optional(),
})

const CreateStackSchema = z.object({
  environmentId: z.number().int().positive(),
  name: z.string().min(1),
  webhookUrl: z.string().url(),
  webhookToken: z.string().min(1),
  stateKeyParam: z.string().min(1).default('hostname'),
  steps: z.array(StackStepSchema).min(1),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await listPipelineStacks(parseInt(id, 10)))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = CreateStackSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createPipelineStack(parseInt(id, 10), parsed.data), 201)
}
