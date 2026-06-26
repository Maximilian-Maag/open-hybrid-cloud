import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'

const CreateCategorySchema = z.object({
  name: z.string().min(1),
  displayOrder: z.number().int().default(0),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.displayOrder), asc(categories.name))

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [category] = await db
    .insert(categories)
    .values({ name: parsed.data.name, displayOrder: parsed.data.displayOrder })
    .returning()

  return NextResponse.json(category, { status: 201 })
}
