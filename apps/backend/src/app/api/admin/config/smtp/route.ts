import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getSmtpConfig, updateSmtpConfig } from '@/lib/services/admin/config'

const UpdateSmtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  from: z.string().min(1),
  user: z.string().default(''),
  password: z.string().optional(),
  tls: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  return toResponse(await getSmtpConfig())
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = UpdateSmtpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  await updateSmtpConfig(parsed.data)
  return NextResponse.json({ success: true })
}
