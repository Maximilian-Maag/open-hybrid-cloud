import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { getBrandingLogo, updateBrandingLogo } from '@/lib/services/admin/branding'

export async function GET() {
  const result = await getBrandingLogo()

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  if (!result.data) return new NextResponse(null, { status: 404 })

  return new NextResponse(new Uint8Array(result.data.data), {
    headers: {
      'Content-Type': result.data.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const formData = await req.formData()
  const file = formData.get('logo')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No logo file provided' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = file.type || 'image/png'

  await updateBrandingLogo(buffer, mimeType)
  return NextResponse.json({ success: true })
}
