import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listEnvironments, createEnvironment } from '@/lib/services/admin/environments'

const CreateEnvironmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  ciSourceId: z.number().int().positive(),
  webhookUrl: z.string().url(),
  webhookToken: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  return toResponse(await listEnvironments())
}

export async function POST(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createEnvironment(parsed.data), 201)
}
