import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCiSources, createCiSource } from '@/lib/services/admin/ciSources'

const CreateCiSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  accessToken: z.string().min(1),
  provider: z.enum(['gitlab', 'github', 'bitbucket']),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  return toResponse(await listCiSources())
}

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateCiSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createCiSource(parsed.data), 201)
}
