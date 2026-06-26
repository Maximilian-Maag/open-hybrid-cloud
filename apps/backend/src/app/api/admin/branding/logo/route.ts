import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { branding } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() {
  const rows = await db
    .select({ logoData: branding.logoData, logoMime: branding.logoMime })
    .from(branding)
    .where(eq(branding.id, 1))
    .limit(1)

  if (!rows.length || !rows[0].logoData) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(rows[0].logoData, {
    headers: {
      'Content-Type': rows[0].logoMime ?? 'image/png',
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

  await db
    .insert(branding)
    .values({ id: 1, logoData: buffer, logoMime: mimeType })
    .onConflictDoUpdate({
      target: branding.id,
      set: { logoData: buffer, logoMime: mimeType },
    })

  return NextResponse.json({ success: true })
}
