import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getSmtpConfig, updateSmtpConfig } from '@/lib/services/admin/config'

/**
 * Host and from are either both set or both empty.
 *
 * They used to be `.min(1)`, which made SMTP a one-way door: an operator who
 * typed the wrong hostname could replace it with another one but never remove
 * it, and every mail attempt kept reaching for a host that was not there
 * (#317).
 *
 * An empty host is not a new state to support — it is the state the runtime
 * already means by "no SMTP configured". `lib/notification/index.ts` returns
 * null for it and callers fall back to the environment. The only thing that
 * could not produce it was this schema.
 *
 * Half of a pair is still refused. A host with no from address is not a
 * configuration anyone wants; it is a save that went wrong, and it fails at the
 * first send rather than here unless it is caught.
 */
const UpdateSmtpSchema = z
  .object({
    host: z.string(),
    port: z.number().int().positive(),
    from: z.string(),
    user: z.string().default(''),
    password: z.string().optional(),
    tls: z.boolean().default(true),
  })
  .refine((v) => (v.host.trim() === '') === (v.from.trim() === ''), {
    message: 'Set a host and a from address together, or clear both to turn SMTP off.',
    path: ['host'],
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

  await updateSmtpConfig(parsed.data, session.id)
  return NextResponse.json({ success: true })
}
