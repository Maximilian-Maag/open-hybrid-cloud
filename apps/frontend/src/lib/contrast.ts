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
 * #ca8a04 on white measures 2.93:1.
 *
 * Scaling the RGB channels toward black (or toward white on a dark surface)
 * keeps the colour recognisably the same hue while moving its luminance, which
 * is what the ratio actually depends on. Binary search converges in ~20 steps
 * and is deterministic, so the result is stable across renders.
 */
export const readableAccent = (
  colour: string,
  background = '#ffffff',
  target = AA_BODY,
): string => {
  const rgb = parseHex(colour)
  const bg = parseHex(background)
  if (!rgb || !bg) return colour
  if (contrastRatio(colour, background) >= target) return colour

  const toHex = (c: [number, number, number]) =>
    '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

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
    if (contrastRatio(toHex(at(mid)), background) >= target) hi = mid
    else lo = mid
  }
  return toHex(at(hi))
}
