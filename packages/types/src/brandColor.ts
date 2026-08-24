/**
 * What an operator is allowed to save as a branding colour, and the arithmetic
 * behind it.
 *
 * The portal chrome — header, nav, hero, footer, filled primary buttons — is
 * painted on a colour the operator chooses, and the text on it is one of two
 * fixed inks: near-black `#101827` or white. That is a *choice between two*, not
 * a derivation, so for a band of mid-tones neither ink reaches the 7:1 that WCAG
 * 1.4.6 Contrast (Enhanced) asks for. `#1d4ed8` tops out at 6.70:1, `#ca8a04` at
 * 6.05:1, `#16a34a` at 5.39:1.
 *
 * The app used to record 1.4.6 as unreachable for exactly that reason. The
 * decision changed: AAA is the conformance target, so the band is refused at the
 * point where a colour is saved instead. Constraining the palette is a product
 * change, and it is the only one available — the background *is* the brand, and
 * both candidate inks are already the extremes of the range.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A saved brand colour must reach BRAND_MIN_RATIO (7:1) against at least one of
 * the two inks.
 *
 * In luminance terms that is a single interval. The dark ink's relative
 * luminance is 0.01000, so with `contrast = (L_hi + 0.05) / (L_lo + 0.05)`:
 *
 *   white ink passes  ⟺  1.05 / (L + 0.05) ≥ 7   ⟺  L ≤ 0.10
 *   dark ink passes   ⟺  (L + 0.05) / 0.06 ≥ 7   ⟺  L ≥ 0.37
 *
 * So the refused band is relative luminance **0.10 < L < 0.37** — "not dark
 * enough for white text, not light enough for dark text". Everything outside it
 * is allowed, including every colour this app has ever shipped: `#131921`
 * (L = 0.0094) and `#febd69` (L = 0.5944).
 *
 * ── Not just "no" ───────────────────────────────────────────────────────────
 *
 * Refusing a brand colour with "invalid" is hostile: the operator's colour is
 * usually a corporate constant they cannot change. `nearestPassingBrandColor`
 * therefore moves the colour along its own black → colour → white lightness axis
 * — the same axis `accentRamp` walks — until it leaves the band, in whichever
 * direction is closer. The hue survives; only the lightness moves. That is the
 * difference between a constraint and a wall.
 *
 * This module lives in the shared package because BOTH callers need the same
 * answer: the admin form, which must not let an operator submit a colour the API
 * will refuse, and `updateBranding`, which is the actual contract — a direct PUT
 * must not be able to store an unusable colour either.
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
  '#' +
  rgb
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('')

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
// deliberate typography instead of a harsh default, and it still clears AAA
// comfortably wherever pure black would.
export const DARK_INK = '#101827'
export const LIGHT_INK = '#ffffff'

/**
 * Pick the foreground that contrasts best with `background`. Returns the ink
 * plus the ratio achieved, so callers can surface a warning when even the better
 * of the two cannot reach the threshold they need.
 */
export const readableInk = (background: string): { ink: string; ratio: number } => {
  const onLight = contrastRatio(background, DARK_INK)
  const onDark = contrastRatio(background, LIGHT_INK)
  return onLight >= onDark ? { ink: DARK_INK, ratio: onLight } : { ink: LIGHT_INK, ratio: onDark }
}

/** AA thresholds: 4.5:1 for body text, 3:1 for large (>=18.66px bold / 24px). */
export const AA_BODY = 4.5
export const AA_LARGE = 3
/** WCAG 1.4.11: a UI component's boundary needs 3:1 against what is next to it. */
export const AA_NON_TEXT = 3

/** AAA thresholds (1.4.6 Contrast (Enhanced)): 7:1 body, 4.5:1 large text. */
export const AAA_BODY = 7
export const AAA_LARGE = 4.5

/**
 * The threshold a *saved* brand colour has to clear against one of the two inks.
 *
 * Deliberately the body-text figure and not the large-text one. The chrome is
 * not all headings: the nav links, the hero paragraph and the filled buttons on
 * the branding colour are 14px, so the large-text allowance does not apply to
 * them.
 */
export const BRAND_MIN_RATIO = AAA_BODY

/**
 * One hue's lightness axis: `t = 0` is black, `0.5` the colour itself, `1` white.
 *
 * Relative luminance rises monotonically with `t`, which is what makes the two
 * binary searches below terminate on the right side of the band. Blending toward
 * white desaturates as it lightens — that is inherent to any sRGB lightness move
 * and it is what keeps the result recognisably the same hue rather than an
 * arbitrary substitute.
 */
const toneAt = (rgb: [number, number, number], t: number): string => {
  const mix =
    t <= 0.5
      ? rgb.map((v) => v * (t * 2))
      : rgb.map((v) => v + (255 - v) * ((t - 0.5) * 2))
  return toCanonicalHex(mix as [number, number, number])
}

/** Does this colour carry 7:1 text with the better of the two fixed inks? */
export const isAcceptableBrandColor = (colour: string): boolean =>
  parseHex(colour) !== null && readableInk(colour).ratio >= BRAND_MIN_RATIO

/**
 * The shade of `colour` closest to it that a brand colour is allowed to be.
 *
 * Returns the canonical form of `colour` itself when it already passes, and null
 * when the input is not a colour at all — "there is no nearest shade of
 * nonsense" is a different answer from "this shade is fine".
 *
 * Direction is chosen by luminance distance, not by taste: a colour at L = 0.15
 * is 0.05 below the dark end of the band and 0.22 above the light end, so it
 * darkens. Ties darken, because darkening preserves saturation and lightening
 * washes it out.
 */
export const nearestPassingBrandColor = (colour: string): string | null => {
  const rgb = parseHex(colour)
  if (!rgb) return null
  const canonical = toCanonicalHex(rgb)
  if (readableInk(canonical).ratio >= BRAND_MIN_RATIO) return canonical

  const luminance = relativeLuminance(rgb)
  // The band's two edges, derived from BRAND_MIN_RATIO rather than hardcoded, so
  // moving the threshold moves the band with it.
  const darkEdge = 1.05 / BRAND_MIN_RATIO - 0.05
  const lightEdge = BRAND_MIN_RATIO * (relativeLuminance([16, 24, 39]) + 0.05) - 0.05

  // `t = 0.5` is the colour itself and it fails, so each search starts from a
  // known-failing end and a known-passing one: black passes with white ink, white
  // passes with the dark ink.
  const darken = luminance - darkEdge <= lightEdge - luminance
  let lo = darken ? 0 : 1 // passes
  let hi = 0.5 // fails
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (readableInk(toneAt(rgb, mid)).ratio >= BRAND_MIN_RATIO) lo = mid
    else hi = mid
  }
  return toneAt(rgb, lo)
}

/** The verdict on one operator-supplied colour, for a form and for the API alike. */
export interface BrandColorCheck {
  /** Canonical `#rrggbb`, or null when the input is not a hex colour. */
  colour: string | null
  /** Best ratio against the two inks. 1 when the input is unparseable. */
  ratio: number
  /** Does it clear `BRAND_MIN_RATIO`? False for anything unparseable. */
  ok: boolean
  /**
   * The nearest allowed shade of the same hue. Equal to `colour` when `ok`, and
   * null only when there was no colour to start from.
   */
  suggestion: string | null
}

export const checkBrandColor = (input: string): BrandColorCheck => {
  const rgb = parseHex(input)
  if (!rgb) return { colour: null, ratio: 1, ok: false, suggestion: null }
  const colour = toCanonicalHex(rgb)
  const ratio = readableInk(colour).ratio
  return {
    colour,
    ratio,
    ok: ratio >= BRAND_MIN_RATIO,
    suggestion: ratio >= BRAND_MIN_RATIO ? colour : nearestPassingBrandColor(colour),
  }
}

/**
 * The English sentence the API refuses with.
 *
 * Backend service messages are English-only in this codebase (see
 * `EMPTY_UPDATE_MESSAGE`); the translated version of this rejection is the
 * branding form's, which never lets a bad value reach the API in the first
 * place. This is what a direct `PUT` gets, and it names the shade to use instead
 * so the caller has somewhere to go.
 */
export const brandColorRejection = (field: string, input: string): string => {
  const { colour, ratio, suggestion } = checkBrandColor(input)
  if (!colour) return `${field} is not a hex colour`
  return (
    `${field} ${colour} reaches only ${ratio.toFixed(2)}:1 against the best available ` +
    `text colour; WCAG 1.4.6 (AAA) needs ${BRAND_MIN_RATIO}:1. ` +
    `The nearest shade of the same hue that does is ${suggestion}.`
  )
}
