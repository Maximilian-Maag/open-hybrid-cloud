import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import {
  updateProductImage,
  deleteProductImage,
  MAX_IMAGE_BYTES,
} from '@/lib/services/admin/products'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  // Checked before reading the body: a 200 MB upload should be refused on its
  // declared length rather than after it has been buffered into memory. The real
  // check still happens on the bytes, because this header is not trustworthy.
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_IMAGE_BYTES * 1.1) {
    return NextResponse.json(
      { error: `Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` },
      { status: 413 },
    )
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('image')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No image file provided' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  return toResponse(await updateProductImage(productId, buffer))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  const result = await deleteProductImage(productId)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return new NextResponse(null, { status: 204 })
}
