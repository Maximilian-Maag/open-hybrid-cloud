import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'

const CreateCiSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  accessToken: z.string().min(1),
  provider: z.enum(['gitlab', 'github', 'bitbucket']),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select({
      id: ciSources.id,
      name: ciSources.name,
      url: ciSources.url,
      provider: ciSources.provider,
      // Never return accessToken
    })
    .from(ciSources)
    .orderBy(ciSources.name)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateCiSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [source] = await db
    .insert(ciSources)
    .values(parsed.data)
    .returning({
      id: ciSources.id,
      name: ciSources.name,
      url: ciSources.url,
      provider: ciSources.provider,
    })

  return NextResponse.json(source, { status: 201 })
}
