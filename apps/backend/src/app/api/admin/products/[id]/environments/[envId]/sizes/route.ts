import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { listSizes, upsertSize } from '@/lib/services/admin/sizes'
import { SIZE_CODE_MAX_LENGTH } from '@/lib/services/sizes'

const UpsertSizeSchema = z.object({
  // The natural key an admin thinks in, so POSTing the same code corrects that
  // size rather than creating a second one. Character set enforced in the service.
  code: z.string().min(1).max(SIZE_CODE_MAX_LENGTH),
  label: z.string().max(120).optional(),
  price: z.string().max(20).optional(),
  currency: z.string().length(3).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
  changelog: z.string().max(2000).optional(),
})

/**
 * Both path ids, or null.
 *
 * `Number` was the wrong tool here: it accepts `0x10` as 16 and ` 5 ` as 5, so a
 * malformed segment reached a real row. `parseRouteId` is digits-only (#143).
 */
const parseIds = (id: string, envId: string): { productId: number; environmentId: number } | null => {
  const productId = parseRouteId(id)
  const environmentId = parseRouteId(envId)
  if (productId === null || environmentId === null) return null
  return { productId, environmentId }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  const ids = parseIds(id, envId)
  if (!ids) return invalidId('product or environment id')

  return toResponse(await listSizes(ids.productId, ids.environmentId))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  const ids = parseIds(id, envId)
  if (!ids) return invalidId('product or environment id')

  const parsed = UpsertSizeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(
    await upsertSize(ids.productId, ids.environmentId, { ...parsed.data, userId: session.id }),
    201,
  )
}
