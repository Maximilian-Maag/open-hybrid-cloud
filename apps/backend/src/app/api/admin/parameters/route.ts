import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listParameters, createParameter } from '@/lib/services/admin/parameters'

const CreateParameterSchema = z.object({
  scope: z.enum(['global', 'category', 'product']),
  scopeId: z.number().int().default(0),
  environmentId: z.number().int().positive().nullable().optional(),
  // Which projects this parameter is narrowed to; absent means "leave alone" on
  // an update and "all projects" on a create, and `[]` clears the narrowing
  // (#275). `positive()` because a project id is a bigserial and 0 is the
  // "no scope" sentinel `scopeId` uses.
  projectIds: z.array(z.number().int().positive()).optional(),
  name: z.string().min(1),
  label: z.string().default(''),
  type: z.enum(['string', 'number', 'bool', 'dropdown', 'size']),
  description: z.string().default(''),
  defaultValue: z.string().default(''),
  required: z.boolean().default(false),
  sizeValues: z.record(z.string(), z.string()).optional(),
  sensitive: z.boolean().default(false),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope') as 'global' | 'category' | 'product' | null
  const scopeId = searchParams.get('scopeId') ? parseInt(searchParams.get('scopeId') ?? '0', 10) : undefined

  return toResponse(await listParameters({ scope: scope ?? undefined, scopeId }))
}

export async function POST(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateParameterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createParameter(parsed.data, session.id), 201)
}
