import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { parseRouteId } from '@/lib/http'
import { updateProductImageAlt, deleteProductImage } from '@/lib/services/admin/products'

/** Both ids, or a 400 — an image id is only meaningful within its product. */
const ids = (id: string, imageId: string): { productId: number; imageRowId: number } | null => {
  const productId = parseRouteId(id)
  const imageRowId = parseRouteId(imageId)
  return productId === null || imageRowId === null ? null : { productId, imageRowId }
}

/** Change the description without re-uploading the file. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, imageId } = await params
  const parsed = ids(id, imageId)
  if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const alt = (body as { alt?: unknown } | null)?.alt
  if (typeof alt !== 'string') {
    return NextResponse.json({ error: 'An image description is required' }, { status: 400 })
  }

  const result = await updateProductImageAlt(parsed.productId, parsed.imageRowId, alt, session.id)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, imageId } = await params
  const parsed = ids(id, imageId)
  if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const result = await deleteProductImage(parsed.productId, parsed.imageRowId, session.id)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return new NextResponse(null, { status: 204 })
}
