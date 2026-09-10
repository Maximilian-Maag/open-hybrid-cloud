import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId } from '@/lib/http'
import {
  addProductImage,
  listProductImages,
  reorderProductImages,
  MAX_IMAGE_BYTES,
} from '@/lib/services/admin/products'

/**
 * A product's gallery (issue #107).
 *
 * This replaced `PUT /admin/products/{id}/image`, which could only overwrite the
 * one picture a product was allowed to have. GET lists it, POST appends to it, and
 * PATCH reorders it; the individual picture — its description, or removing it —
 * lives under `images/{imageId}`.
 */
export async function GET(
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

  return toResponse(await listProductImages(productId))
}

export async function POST(
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
  // exactly what this endpoint must stop producing (#105).
  const alt = formData?.get('alt')
  return toResponse(
    await addProductImage(productId, buffer, typeof alt === 'string' ? alt : '', session.id),
    201,
  )
}

/** Reorder the gallery: the body lists every image id in the order wanted. */
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
  const order = (body as { order?: unknown } | null)?.order
  if (!Array.isArray(order) || order.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    return NextResponse.json(
      { error: 'Provide `order` as the list of image ids in the order you want' },
      { status: 400 },
    )
  }

  const result = await reorderProductImages(productId, order as number[], session.id)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return new NextResponse(null, { status: 204 })
}
