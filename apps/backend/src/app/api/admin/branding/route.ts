import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { branding } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpdateBrandingSchema = z.object({
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  shopName: z.string().optional(),
  shopSubtitle: z.string().optional(),
  imprintText: z.string().optional(),
})

const brandingPublicColumns = {
  id: branding.id,
  primaryColor: branding.primaryColor,
  secondaryColor: branding.secondaryColor,
  shopName: branding.shopName,
  shopSubtitle: branding.shopSubtitle,
  imprintText: branding.imprintText,
  logoMime: branding.logoMime,
  // logoData is not included
}

export async function GET() {
  const rows = await db
    .select(brandingPublicColumns)
    .from(branding)
    .where(eq(branding.id, 1))
    .limit(1)

  if (!rows.length) {
    // Return defaults if no row exists
    return NextResponse.json({
      primaryColor: '#1e40af',
      secondaryColor: '#3b82f6',
      shopName: 'Open Hybrid Cloud',
      shopSubtitle: '',
      imprintText: '',
      logoMime: null,
    })
  }

  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = UpdateBrandingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Upsert
  const [updated] = await db
    .insert(branding)
    .values({ id: 1, ...parsed.data })
    .onConflictDoUpdate({
      target: branding.id,
      set: parsed.data,
    })
    .returning(brandingPublicColumns)

  return NextResponse.json(updated)
}
