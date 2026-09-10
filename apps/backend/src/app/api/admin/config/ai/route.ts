import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getAiConfig, updateAiConfig } from '@/lib/services/admin/config'

const UpdateAiSchema = z.object({
  provider: z.enum(['claude', 'openai', 'azure_openai', 'ollama', 'localai']),
  endpoint: z.string(),
  apiKey: z.string().optional(),
  /*
   * Clearable, for the reason `.min(1)` was wrong on SMTP's host (#317): a
   * value that can be set and never removed is a one-way door. NULL is what
   * `lib/ai` already means by "no model configured" — it falls back to a
   * default — and `updateAiConfig` stores NULL for an empty string so that
   * fallback actually fires.
   */
  model: z.string(),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  return toResponse(await getAiConfig())
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = UpdateAiSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  await updateAiConfig(parsed.data, session.id)
  return NextResponse.json({ success: true })
}
