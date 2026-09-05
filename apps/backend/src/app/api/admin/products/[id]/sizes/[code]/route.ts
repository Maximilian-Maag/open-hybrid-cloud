import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { saveSizeRow, deleteSizeRow } from '@/lib/services/admin/sizes'
import { SIZE_CODE_MAX_LENGTH } from '@/lib/services/sizes'

/**
 * One row of the size matrix — one size, across every environment (issue #249).
 *
 * PUT rather than POST because the body is the row's full desired state: the
 * environments listed in `cells` are the ones the size is offered in, and the
 * ones left out are the ones it is not. That is what makes a single request able
 * to retire a cell, and it is why the service applies the whole row in one
 * transaction — a bulk edit that half-applies leaves a price list that looks
 * finished and is not.
 */
const SaveRowSchema = z.object({
  label: z.string().max(120).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  cells: z
    .array(
      z.object({
        environmentId: z.number().int().positive(),
        // Non-negative with at most two decimals; the character check is the
        // service's, so the per-offering route and this one cannot disagree.
        price: z.string().max(20).optional(),
        currency: z.string().length(3).optional(),
      }),
    )
    .max(200),
  changelog: z.string().max(2000).optional(),
})

/**
 * The size code, not a row id.
 *
 * It is the natural key of the row axis — the matrix's whole point is that 'XL'
 * names the same size in every environment, while the ids underneath differ per
 * offering. The character set is the service's `CODE_PATTERN`; the length is
 * bounded here so an absurd segment never reaches a query.
 */
const parseCode = (raw: string): string | null => {
  const code = decodeURIComponent(raw).trim()
  return code.length > 0 && code.length <= SIZE_CODE_MAX_LENGTH ? code : null
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, code: rawCode } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const code = parseCode(rawCode)
  if (code === null) return invalidId('size code')

  const parsed = SaveRowSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await saveSizeRow(productId, code, { ...parsed.data, userId: session.id }))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, code: rawCode } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const code = parseCode(rawCode)
  if (code === null) return invalidId('size code')

  return toResponse(await deleteSizeRow(productId, code, session.id))
}
