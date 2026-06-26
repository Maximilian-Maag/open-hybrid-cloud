import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpdateCiSourceSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  accessToken: z.string().min(1).optional(),
  provider: z.enum(['gitlab', 'github', 'bitbucket']).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const rows = await db
    .select({
      id: ciSources.id,
      name: ciSources.name,
      url: ciSources.url,
      provider: ciSources.provider,
      // Never return accessToken
    })
    .from(ciSources)
    .where(eq(ciSources.id, parseInt(id, 10)))
    .limit(1)

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpdateCiSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [updated] = await db
    .update(ciSources)
    .set(parsed.data)
    .where(eq(ciSources.id, parseInt(id, 10)))
    .returning({
      id: ciSources.id,
      name: ciSources.name,
      url: ciSources.url,
      provider: ciSources.provider,
    })

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const deleted = await db
    .delete(ciSources)
    .where(eq(ciSources.id, parseInt(id, 10)))
    .returning({ id: ciSources.id })

  if (!deleted.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
