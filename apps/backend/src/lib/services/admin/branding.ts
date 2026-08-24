import { db } from '@/lib/db/client'
import { branding } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { logAudit, changedFields } from '@/lib/audit'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'
import { brandColorRejection, isAcceptableBrandColor } from '@open-hybrid-cloud/types'
import {
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  detectImageMime,
  safeImageContentType,
} from '@/lib/services/imageUpload'

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
      primaryColor: '#131921',
      secondaryColor: '#febd69',
      shopName: 'Open Hybrid Cloud',
      shopSubtitle: '',
      imprintText: '',
      logoMime: null,
    })
  }

  return ok(rows[0] as BrandingConfig)
}

/**
 * The colours an operator may store, checked HERE rather than only in the form.
 *
 * The portal chrome is painted on these two values and the text on it is one of
 * two fixed inks, so a mid-tone choice cannot reach the 7:1 that WCAG 1.4.6 asks
 * for whichever ink is picked (`#ca8a04` tops out at 6.05:1). The gate now
 * enforces 1.4.6 on every page, which means an unusable colour in this table is
 * a red CI run for everyone — and the branding form is a convenience, not the
 * contract. A direct `PUT /api/admin/branding` has to be refused too.
 *
 * The rejection names the nearest shade of the same hue that would be accepted,
 * because an operator's brand colour is usually a constant they cannot change and
 * "invalid" on its own leaves them nowhere to go. See `brandColor.ts` in
 * `@open-hybrid-cloud/types` for the band and the arithmetic.
 */
const rejectUnusableColors = (input: UpdateBrandingInput): string | null => {
  for (const [field, label] of [
    ['primaryColor', 'Primary color'],
    ['secondaryColor', 'Secondary color'],
  ] as const) {
    const value = input[field]
    // `undefined` means "not being changed"; only a supplied value is judged.
    if (value === undefined) continue
    if (!isAcceptableBrandColor(value)) return brandColorRejection(label, value)
  }
  return null
}

export const updateBranding = async (
  input: UpdateBrandingInput,
  actorId?: number,
): Promise<Result<BrandingConfig>> => {
  // `onConflictDoUpdate({ set: {} })` hits the same "No values to set" as a bare
  // `.set({})`, and every field of this schema is optional.
  if (isEmptyUpdate(input)) return err(400, EMPTY_UPDATE_MESSAGE)

  const unusable = rejectUnusableColors(input)
  if (unusable) return err(400, unusable)

  const [updated] = await db
    .insert(branding)
    .values({ id: 1, ...input })
    .onConflictDoUpdate({ target: branding.id, set: input })
    .returning(brandingPublicColumns)

  await logAudit(actorId ?? null, 'branding.updated', undefined, changedFields(input))

  return ok(updated as BrandingConfig)
}

export const getBrandingLogo = async (): Promise<Result<{ data: Buffer; mime: string } | null>> => {
  const rows = await db
    .select({ logoData: branding.logoData, logoMime: branding.logoMime })
    .from(branding)
    .where(eq(branding.id, 1))
    .limit(1)

  if (!rows.length || !rows[0].logoData) return ok(null)

  // Clamped on the way out, not just on the way in: this blob is served by an
  // UNAUTHENTICATED GET, and any row written before the upload path sniffed the
  // bytes can still hold whatever type its uploader declared — `text/html`
  // included, which the browser would render as a document on the backend's own
  // origin. Anything unrecognised becomes an opaque download instead.
  return ok({ data: rows[0].logoData, mime: safeImageContentType(rows[0].logoMime ?? 'image/png') })
}

/**
 * Replace the shop logo.
 *
 * Validates exactly like `updateProductImage`, because the logo is the more
 * exposed of the two: the route used to take `file.type` on trust, store it, and
 * echo it back as the `Content-Type` of an unauthenticated GET, with no size cap
 * — so a root admin uploading `logo.html` got stored XSS on the backend origin,
 * served to anonymous visitors (issue #143).
 *
 * Takes the bytes only. The declared type is not a parameter any more, so there is
 * nothing for a caller to pass through unchecked.
 */
export const updateBrandingLogo = async (
  buffer: Buffer,
  actorId?: number,
): Promise<Result<{ mime: string }>> => {
  if (buffer.length === 0) return err(400, 'The uploaded file is empty')
  if (buffer.length > MAX_IMAGE_BYTES) {
    return err(413, `Logo is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`)
  }

  const mime = detectImageMime(buffer)
  if (mime === null) {
    return err(415, `Unsupported image type — allowed: ${ALLOWED_IMAGE_MIMES.join(', ')}`)
  }

  await db
    .insert(branding)
    .values({ id: 1, logoData: buffer, logoMime: mime })
    .onConflictDoUpdate({
      target: branding.id,
      set: { logoData: buffer, logoMime: mime },
    })

  await logAudit(actorId ?? null, 'branding.logo_updated', undefined, `Logo replaced (${mime}, ${buffer.length} bytes)`)

  return ok({ mime })
}
