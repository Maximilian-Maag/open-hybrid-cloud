import { db } from '@/lib/db/client'
import { branding } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { checkBrandColor, BRAND_MIN_RATIO } from '@open-hybrid-cloud/types'
import { logAudit } from '@/lib/audit'

/** The shipped pair, and the fallback for a stored value that is not a colour at all. */
const DEFAULTS = { primaryColor: '#131921', secondaryColor: '#febd69' } as const

export interface BrandingContrastFix {
  field: 'primaryColor' | 'secondaryColor'
  from: string
  to: string
  ratio: number
}

/**
 * Bring an already-saved branding row up to the rule `updateBranding` now
 * enforces, once, at boot.
 *
 * The rule (7:1 against one of the two inks — see `brandColor.ts`) arrived after
 * this table had been written to, so an existing deployment can hold a colour
 * that the API would now refuse. That is not a hypothetical: the value this
 * repo's own a11y suite used as its "hostile" colour, `#ca8a04`, is in the band,
 * and so is anything an operator picked out of a mid-tone palette.
 *
 * ── Why a boot-time migration and not a read-time clamp ─────────────────────
 *
 * Clamping in `getBranding` would leave the stored value and the rendered value
 * permanently disagreeing. The operator would open /admin/branding, see the
 * colour they chose, and find the header painted a different one, with nothing
 * anywhere to explain the gap — and the first time they edited an unrelated
 * field, the form would resubmit that stored colour and the API would refuse the
 * save. Nudging the row once keeps store and render identical and leaves the
 * operator with a form that works.
 *
 * ── Why not a SQL migration ─────────────────────────────────────────────────
 *
 * The nudge is "nearest shade of the same hue", which needs the sRGB
 * linearisation and the binary search in `nearestPassingBrandColor`. Reproducing
 * that in a `.sql` file would be a second implementation of the rule, free to
 * drift from the one the API validates against. `runBootstrap` already runs the
 * migrations and already seeds this table, so it is where this belongs.
 *
 * ── The operator is told ────────────────────────────────────────────────────
 *
 * Every change writes an audit entry naming the old colour, the new one and the
 * reason, so it shows up in /audit like any other branding edit rather than
 * happening invisibly. It also goes to stderr at boot, because the person
 * reading the deployment log is usually the person who has to explain it.
 *
 * Idempotent: a colour that already passes is returned unchanged, so a second
 * boot finds nothing to do and writes nothing.
 */
export const reconcileBrandingContrast = async (): Promise<BrandingContrastFix[]> => {
  const rows = await db
    .select({ primaryColor: branding.primaryColor, secondaryColor: branding.secondaryColor })
    .from(branding)
    .where(eq(branding.id, 1))
    .limit(1)

  if (!rows.length) return []

  const fixes: BrandingContrastFix[] = []
  const patch: { primaryColor?: string; secondaryColor?: string } = {}

  for (const field of ['primaryColor', 'secondaryColor'] as const) {
    const current = rows[0][field]
    const check = checkBrandColor(current ?? '')
    if (check.ok) continue
    // `suggestion` is null only when the stored string was never a colour — an
    // empty column, or something hand-edited. There is no "nearest shade" of
    // that, so it goes back to the value a fresh install would have had.
    const next = check.suggestion ?? DEFAULTS[field]
    patch[field] = next
    fixes.push({ field, from: current ?? '', to: next, ratio: check.ratio })
  }

  if (!fixes.length) return []

  await db.update(branding).set(patch).where(eq(branding.id, 1))

  const summary = fixes
    .map(
      (f) =>
        `${f.field} ${f.from} → ${f.to} (was ${f.ratio.toFixed(2)}:1 against the best ` +
        `available text colour, WCAG 1.4.6 needs ${BRAND_MIN_RATIO}:1)`,
    )
    .join('; ')

  await logAudit(null, 'branding.contrast_migrated', undefined, summary)
  console.warn(`[bootstrap] branding adjusted for WCAG 1.4.6: ${summary}`)

  return fixes
}
