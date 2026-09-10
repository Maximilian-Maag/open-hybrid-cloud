import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { getBrandingLogo, updateBrandingLogo } from '@/lib/services/admin/branding'
import { MAX_IMAGE_BYTES } from '@/lib/services/imageUpload'

export async function GET() {
  const result = await getBrandingLogo()

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  if (!result.data) return new NextResponse(null, { status: 404 })

  return new NextResponse(new Uint8Array(result.data.data), {
    headers: {
      // Already clamped to an allowed image type by the service; nosniff makes
      // sure the browser does not go looking for a better guess than the one we
      // gave it. This response is unauthenticated and public.
      'Content-Type': result.data.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  // Checked before reading the body, the way the product image route does it: a
  // 200 MB upload should be refused on its declared length rather than after it
  // has been buffered into memory. The real check still happens on the bytes,
  // because this header is not trustworthy.
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_IMAGE_BYTES * 1.1) {
    return NextResponse.json(
      { error: `Logo is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` },
      { status: 413 },
    )
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('logo')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No logo file provided' }, { status: 400 })
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Logo is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` },
      { status: 413 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // `file.type` is deliberately not passed on: the service decides the type from
  // the magic bytes, so a declared `image/png` on an HTML document is irrelevant.
  const result = await updateBrandingLogo(buffer, session.id)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

  // `success` kept alongside the new `mime` so existing callers keep working.
  return NextResponse.json({ success: true, mime: result.data.mime })
}
