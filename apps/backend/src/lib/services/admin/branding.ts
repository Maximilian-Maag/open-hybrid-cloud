import { db } from '@/lib/db/client'
import { branding } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, type Result } from '@/lib/services/result'

export interface BrandingConfig {
  id?: number
  primaryColor: string
  secondaryColor: string
  shopName: string
  shopSubtitle: string
  imprintText: string
  logoMime: string | null
}

export interface UpdateBrandingInput {
  primaryColor?: string
  secondaryColor?: string
  shopName?: string
  shopSubtitle?: string
  imprintText?: string
}

const brandingPublicColumns = {
  id: branding.id,
  primaryColor: branding.primaryColor,
  secondaryColor: branding.secondaryColor,
  shopName: branding.shopName,
  shopSubtitle: branding.shopSubtitle,
  imprintText: branding.imprintText,
  logoMime: branding.logoMime,
}

export const getBranding = async (): Promise<Result<BrandingConfig>> => {
  const rows = await db
    .select(brandingPublicColumns)
    .from(branding)
    .where(eq(branding.id, 1))
    .limit(1)

  if (!rows.length) {
    return ok({
      primaryColor: '#1e40af',
      secondaryColor: '#3b82f6',
      shopName: 'Open Hybrid Cloud',
      shopSubtitle: '',
      imprintText: '',
      logoMime: null,
    })
  }

  return ok(rows[0] as BrandingConfig)
}

export const updateBranding = async (input: UpdateBrandingInput): Promise<Result<BrandingConfig>> => {
  const [updated] = await db
    .insert(branding)
    .values({ id: 1, ...input })
    .onConflictDoUpdate({ target: branding.id, set: input })
    .returning(brandingPublicColumns)

  return ok(updated as BrandingConfig)
}

export const getBrandingLogo = async (): Promise<Result<{ data: Buffer; mime: string } | null>> => {
  const rows = await db
    .select({ logoData: branding.logoData, logoMime: branding.logoMime })
    .from(branding)
    .where(eq(branding.id, 1))
    .limit(1)

  if (!rows.length || !rows[0].logoData) return ok(null)

  return ok({ data: rows[0].logoData, mime: rows[0].logoMime ?? 'image/png' })
}

export const updateBrandingLogo = async (
  buffer: Buffer,
  mime: string,
): Promise<Result<void>> => {
  await db
    .insert(branding)
    .values({ id: 1, logoData: buffer, logoMime: mime })
    .onConflictDoUpdate({
      target: branding.id,
      set: { logoData: buffer, logoMime: mime },
    })

  return ok(undefined)
}
