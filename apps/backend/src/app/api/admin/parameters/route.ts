import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listParameters, createParameter } from '@/lib/services/admin/parameters'

const CreateParameterSchema = z.object({
  scope: z.enum(['global', 'category', 'product']),
  scopeId: z.number().int().default(0),
  environmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'bool', 'dropdown']),
  description: z.string().default(''),
  defaultValue: z.string().default(''),
  required: z.boolean().default(false),
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

  return toResponse(await createParameter(parsed.data), 201)
}
