/**
 * Contrast helpers for operator-chosen branding colours.
 *
 * The WCAG arithmetic itself — hex parsing, relative luminance, contrast ratio,
 * the two fixed inks and the AA/AAA thresholds — lives in
 * `@open-hybrid-cloud/types` and is re-exported here. It moved because the
 * backend needs the same numbers: a brand colour is now REFUSED when neither ink
 * can reach 7:1 on it (WCAG 1.4.6), and that rule has to hold at the API, not
 * only in the form. Two copies of a luminance formula is how the form and the
 * API end up disagreeing about which colours exist.
 *
 * What stays here is the part only the browser needs: the derived accent colour
 * and the chart ramp, both of which are about painting the brand ON the app's own
 * surfaces rather than the other way round.
 *
 * Ratios follow WCAG 2.1 relative luminance (1.4.3 / 1.4.6 / 1.4.11).
 */

export {
  parseHex,
  toCanonicalHex,
  relativeLuminance,
  contrastRatio,
  readableInk,
  isAcceptableBrandColor,
  nearestPassingBrandColor,
  checkBrandColor,
  DARK_INK,
  LIGHT_INK,
  AA_BODY,
  AA_LARGE,
  AA_NON_TEXT,
  AAA_BODY,
  AAA_LARGE,
  BRAND_MIN_RATIO,
} from '@open-hybrid-cloud/types'
export type { BrandColorCheck } from '@open-hybrid-cloud/types'

import { contrastRatio, parseHex, readableInk, relativeLuminance, toCanonicalHex, AA_BODY, AA_NON_TEXT, AAA_BODY } from '@open-hybrid-cloud/types'

/**
 * The reference surface for accent colours used AS text or as a filled control.
 *
 * NOT white. The dashboard body is `bg-slate-50` (#f8fafc) and several chips sit on
 * `bg-slate-100` (#f1f5f9), so a colour tuned to exactly 4.5:1 against #ffffff
 * measures ~4.3:1 where it is actually painted — which is how two 12px links on the
 * home page failed the axe gate with a mid-tone brand colour. Deriving against the
 * darkest of those surfaces satisfies all three, and the extra darkening is
 * imperceptible.
 */
export const SURFACE = '#f1f5f9'

/**
 * Does this background support AA body text with the best available ink?
 *
 * Kept as the weaker of the two questions even though the saved-colour rule is
 * now the AAA one: it is what the AA regression tests are written against, and a
 * colour that fails this fails 1.4.3 as well as 1.4.6.
 */
export const meetsAaBody = (background: string): boolean =>
  readableInk(background).ratio >= AA_BODY

/**
 * The same question at the AAA threshold — and, since the owner's decision to
 * make AAA mandatory, the rule that actually governs what can be saved.
 * `isAcceptableBrandColor` is the same predicate under the name the validation
 * uses; this one stays because the branding form asks it about a value the
 * operator is still typing.
 */
export const meetsAaaBody = (background: string): boolean =>
  readableInk(background).ratio >= AAA_BODY

/**
 * Adjust `colour` until it reaches `target` contrast against `background`,
 * keeping its hue.
 *
 * This is the other half of the branding problem. `readableInk` handles text
 * painted ON the brand colour; this handles the brand colour used AS text on a
 * light surface — "View all", "Order now", the category links. A pale or
 * mid-tone brand colour is unreadable there no matter what the surface does:
 * #ca8a04 on white measures 2.93:1. The default background is SURFACE rather than
 * white for the reason given there.
 *
 * Scaling the RGB channels toward black (or toward white on a dark surface)
 * keeps the colour recognisably the same hue while moving its luminance, which
 * is what the ratio actually depends on. Binary search converges in ~20 steps
 * and is deterministic, so the result is stable across renders.
 *
 * The default target is AAA, not AA. That is not ambition: because this function
 * DERIVES a colour rather than choosing between two, 7:1 is always reachable, and
 * the AA derivation had already given up on the brand swatch anyway — #febd69
 * comes out of it as #8e693b, a brown. Going the rest of the way to #694e2c costs
 * no recognisability that AA had not already spent. Callers that need less say so:
 * AA_NON_TEXT for a control boundary, AA_LARGE for a focus ring.
 */
export const readableAccent = (
  colour: string,
  background = SURFACE,
  target = AAA_BODY,
): string => {
  const rgb = parseHex(colour)
  const bg = parseHex(background)
  if (!rgb || !bg) return colour
  if (contrastRatio(colour, background) >= target) return colour

  // Darken against a light background, lighten against a dark one.
  const bgIsLight = relativeLuminance(bg) > 0.5
  const at = (t: number): [number, number, number] =>
    bgIsLight
      ? [rgb[0] * (1 - t), rgb[1] * (1 - t), rgb[2] * (1 - t)]
      : [rgb[0] + (255 - rgb[0]) * t, rgb[1] + (255 - rgb[1]) * t, rgb[2] + (255 - rgb[2]) * t]

  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (contrastRatio(toCanonicalHex(at(mid)), background) >= target) hi = mid
    else lo = mid
  }
  return toCanonicalHex(at(hi))
}

/**
 * One hue at `steps` distinguishable lightnesses, darkest first, every one of them
 * still clearing `target` against `background` (issue #106).
 *
 * The cost charts stack several segments in a single bar, and the app has exactly
 * one chart colour to spend: the operator's. A categorical palette is not available
 * — there is no second brand hue — so the segments are stepped tone-on-tone in the
 * order the data is already sorted in (largest share darkest), which is an ordinal
 * ramp over an ordered dimension rather than arbitrary colours on nominal ones.
 *
 * The floor is what makes it survive branding. `readableAccent` moves a colour in
 * one direction only, so it cannot produce a ramp: a colour that already clears the
 * target comes back unchanged, giving `steps` identical tones. This walks a single
 * black → colour → white lightness parameter instead, whose contrast against a light
 * surface falls monotonically, and binary-searches the tone that hits each step's
 * ratio. Every step therefore clears 1.4.11's 3:1 against the card it is painted on,
 * whatever the operator picked — including a near-white secondary.
 *
 * Colour is never the only channel: the legend beside these segments carries the
 * label, the amount and the share as text.
 */
export const accentRamp = (
  colour: string,
  steps: number,
  background = SURFACE,
  target = AA_NON_TEXT,
): string[] => {
  const rgb = parseHex(colour)
  if (!rgb || steps <= 0) return Array.from({ length: Math.max(0, steps) }, () => colour)

  /** t = 0 is black, 0.5 the colour itself, 1 white — luminance rises with t. */
  const toneAt = (t: number): string => {
    const mix = t <= 0.5
      ? rgb.map((v) => v * (t * 2))
      : rgb.map((v) => v + (255 - v) * ((t - 0.5) * 2))
    return toCanonicalHex(mix as [number, number, number])
  }

  const solve = (ratio: number): string => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      // Contrast falls as t rises, so keep the half that still clears the ratio.
      if (contrastRatio(toneAt(mid), background) >= ratio) lo = mid
      else hi = mid
    }
    return toneAt(lo)
  }

  // The darkest step stops short of black so the hue stays recognisable; the
  // lightest sits on the non-text floor rather than below it.
  const DARKEST = 9
  if (steps === 1) return [solve(DARKEST)]
  return Array.from({ length: steps }, (_, i) =>
    solve(DARKEST - ((DARKEST - target) * i) / (steps - 1)),
  )
}
