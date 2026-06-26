import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { parameters } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

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
  const scopeId = searchParams.get('scopeId') ? parseInt(searchParams.get('scopeId')!, 10) : undefined

  const conditions = []
  if (scope) conditions.push(eq(parameters.scope, scope))
  if (scopeId !== undefined) conditions.push(eq(parameters.scopeId, scopeId))

  const rows = await db
    .select()
    .from(parameters)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(parameters.scope, parameters.scopeId, parameters.name)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateParameterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [param] = await db
    .insert(parameters)
    .values({
      ...parsed.data,
      environmentId: parsed.data.environmentId ?? null,
    })
    .returning()

  return NextResponse.json(param, { status: 201 })
}
