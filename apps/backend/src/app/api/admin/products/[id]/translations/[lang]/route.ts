import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { upsertTranslation } from '@/lib/services/admin/products'

const UpsertTranslationSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lang: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, lang } = await params

  const body = await req.json().catch(() => null)
  const parsed = UpsertTranslationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await upsertTranslation(parseInt(id, 10), lang, parsed.data))
}
