import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId } from '@/lib/http'
import {
  updateProductImage,
  updateProductImageAlt,
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
  const productId = parseRouteId(id)
  if (productId === null) {
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

  // The declared length above is a hint a client can lie about; this is the real
  // size, and checking it here refuses an oversized upload before a second copy
  // of it is materialised as a Buffer.
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` },
      { status: 413 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // Uploaded together with the file, because an image without a description is
  // exactly what this endpoint must stop producing.
  const alt = formData?.get('alt')
  return toResponse(await updateProductImage(productId, buffer, typeof alt === 'string' ? alt : ''))
}

/** Change the description without re-uploading the file. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const alt = (body as { alt?: unknown } | null)?.alt
  if (typeof alt !== 'string') {
    return NextResponse.json({ error: 'An image description is required' }, { status: 400 })
  }

  const result = await updateProductImageAlt(productId, alt)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return new NextResponse(null, { status: 204 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  const result = await deleteProductImage(productId)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return new NextResponse(null, { status: 204 })
}
