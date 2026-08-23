/**
 * Contrast helpers for operator-chosen branding colours.
 *
 * The portal lets an operator pick any primary colour, and the header, nav, hero
 * and footer are painted on top of it. Those surfaces used to hardcode white
 * text, which is only legible while the colour stays dark — the shipped default
 * (#131921) passes, a mid-tone like #ca8a04 drops to 1.88:1 against a required
 * 4.5:1. Rather than trusting the operator to pick well, derive the foreground
 * from the chosen background and warn when a pair still cannot reach AA.
 *
 * Ratios follow WCAG 2.1 relative luminance (1.4.3 / 1.4.11).
 */

/** #rgb / #rrggbb → [r, g, b] in 0–255, or null when unparseable. */
export const parseHex = (hex: string): [number, number, number] | null => {
  const h = hex.trim().replace(/^#/, '')
  if (h.length === 3) {
    const [r, g, b] = h.split('')
    if (!/^[0-9a-f]{3}$/i.test(h)) return null
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
  }
  if (h.length === 6) {
    if (!/^[0-9a-f]{6}$/i.test(h)) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  return null
}

/** [r, g, b] → canonical lowercase #rrggbb, which is what <input type="color"> requires. */
export const toCanonicalHex = (rgb: [number, number, number]): string =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** WCAG relative luminance, 0 (black) – 1 (white). */
export const relativeLuminance = (rgb: [number, number, number]): number => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two hex colours, 1–21. Returns 1 if either is unparseable. */
export const contrastRatio = (a: string, b: string): number => {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 1
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// Near-black rather than pure black: on a mid-tone brand colour it reads as
// deliberate typography instead of a harsh default, and it still clears AA
// comfortably wherever pure black would.
const DARK_INK = '#101827'
const LIGHT_INK = '#ffffff'

/**
 * Pick the foreground that contrasts best with `background`. Returns the ink
 * plus the ratio achieved, so callers can surface a warning when even the better
 * of the two cannot reach the threshold they need.
 */
export const readableInk = (background: string): { ink: string; ratio: number } => {
  const onLight = contrastRatio(background, DARK_INK)
  const onDark = contrastRatio(background, LIGHT_INK)
  return onLight >= onDark
    ? { ink: DARK_INK, ratio: onLight }
    : { ink: LIGHT_INK, ratio: onDark }
}

/** AA thresholds: 4.5:1 for body text, 3:1 for large (>=18.66px bold / 24px). */
export const AA_BODY = 4.5
export const AA_LARGE = 3
/** WCAG 1.4.11: a UI component's boundary needs 3:1 against what is next to it. */
export const AA_NON_TEXT = 3

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
 * Used by the branding form to warn before an operator saves a colour that
 * would make the portal chrome unreadable.
 */
export const meetsAaBody = (background: string): boolean =>
  readableInk(background).ratio >= AA_BODY

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
 */
export const readableAccent = (
  colour: string,
  background = SURFACE,
  target = AA_BODY,
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
