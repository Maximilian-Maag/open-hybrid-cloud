import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { upsertTranslation } from '@/lib/services/admin/products'

const UpsertTranslationSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  // No default: absent means "leave the long text as it is", so the AI translator
  // and any caller that only knows about name+description cannot blank out prose
  // somebody wrote by hand (issue #107).
  longDescription: z.string().max(20_000).optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lang: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, lang } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')

  const body = await req.json().catch(() => null)
  const parsed = UpsertTranslationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await upsertTranslation(productId, lang, parsed.data, session.id))
}
