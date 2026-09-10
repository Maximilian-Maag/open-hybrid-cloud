import { describe, it, expect } from 'vitest'
import {
  parseHex,
  contrastRatio,
  readableInk,
  meetsAaBody,
  meetsAaaBody,
  AA_BODY,
  AAA_BODY,
  readableAccent,
  accentRamp,
  SURFACE,
  AA_NON_TEXT,
} from './contrast'

describe('parseHex', () => {
  it('parses #rrggbb', () => {
    expect(parseHex('#131921')).toEqual([0x13, 0x19, 0x21])
  })

  it('parses #rgb shorthand by doubling each digit', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('#0a3')).toEqual([0x00, 0xaa, 0x33])
  })

  it('tolerates a missing hash and surrounding whitespace', () => {
    expect(parseHex('  febd69 ')).toEqual([0xfe, 0xbd, 0x69])
  })

  it('returns null for anything unparseable', () => {
    expect(parseHex('#12')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    expect(parseHex('rebeccapurple')).toBeNull()
    expect(parseHex('#gggggg')).toBeNull()
    expect(parseHex('')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('gives 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#ca8a04', '#ca8a04')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#131921', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#131921'), 10)
  })

  it('reproduces the ratio measured on the live portal for the amber branding', () => {
    // The audit measured white on #ca8a04 at 2.93:1 in the browser.
    expect(contrastRatio('#ffffff', '#ca8a04')).toBeCloseTo(2.93, 1)
  })

  it('degrades to 1 rather than throwing on invalid input', () => {
    expect(contrastRatio('nonsense', '#ffffff')).toBe(1)
  })
})

describe('readableInk', () => {
  it('picks white on the shipped dark default', () => {
    const { ink, ratio } = readableInk('#131921')
    expect(ink).toBe('#ffffff')
    expect(ratio).toBeGreaterThan(AA_BODY)
  })

  it('picks dark ink on the amber that broke the header', () => {
    // This is the whole point: white text on #ca8a04 measured 2.93:1, while the
    // dark ink clears AA — so the fix is to switch ink, not to ban the colour.
    const { ink, ratio } = readableInk('#ca8a04')
    expect(ink).toBe('#101827')
    expect(ratio).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('picks dark ink on the shipped secondary colour', () => {
    expect(readableInk('#febd69').ink).toBe('#101827')
  })

  it('always returns the better of the two options', () => {
    for (const c of ['#000000', '#ffffff', '#808080', '#ca8a04', '#0f6e6e', '#febd69']) {
      const { ink, ratio } = readableInk(c)
      const other = ink === '#ffffff' ? '#101827' : '#ffffff'
      expect(ratio).toBeGreaterThanOrEqual(contrastRatio(c, other))
    }
  })
})

describe('meetsAaBody', () => {
  it('accepts colours where either ink clears AA', () => {
    expect(meetsAaBody('#131921')).toBe(true)
    expect(meetsAaBody('#ca8a04')).toBe(true)
    expect(meetsAaBody('#ffffff')).toBe(true)
  })

  it('rejects the narrow mid band where neither ink can reach 4.5:1', () => {
    // With a near-black dark ink the unusable band is narrow — roughly #777777
    // to #7f7f7f, worst around #7b7b7b at 4.23:1. Anything darker clears AA
    // with white, anything lighter clears it with the dark ink.
    expect(meetsAaBody('#7b7b7b')).toBe(false) // 4.23:1 — worst case
    expect(meetsAaBody('#777777')).toBe(false) // 4.48:1
    expect(meetsAaBody('#808080')).toBe(false) // 4.4986:1 — just misses
  })

  it('accepts the values just outside that band', () => {
    expect(meetsAaBody('#767676')).toBe(true) // 4.542:1 with white
    expect(meetsAaBody('#818181')).toBe(true) // 4.561:1 with the dark ink
  })

  it('treats an unparseable colour as failing rather than passing', () => {
    expect(meetsAaBody('#zzz')).toBe(false)
  })
})

describe('readableAccent', () => {
  it('leaves a colour that already clears AA alone', () => {
    // No point darkening something already readable — that would drift the brand.
    expect(readableAccent('#101827')).toBe('#101827')
  })

  it('darkens a mid-tone brand colour until it clears AA as text', () => {
    const accent = readableAccent('#ca8a04')
    expect(contrastRatio(accent, SURFACE)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('clears AA on every light surface the app paints it on, not just white', () => {
    // The regression this exists for: tuned against #ffffff, the amber accent
    // measured 4.5:1 in theory and 4.3:1 where it was actually painted — two 12px
    // links on the dashboard home page, on the slate-50 body.
    const accent = readableAccent('#ca8a04')
    for (const surface of ['#ffffff', '#f8fafc', '#f1f5f9']) {
      expect(contrastRatio(accent, surface), `on ${surface}`).toBeGreaterThanOrEqual(AA_BODY)
    }
  })

  it('lightens instead of darkening against a dark surface', () => {
    const accent = readableAccent('#1d4ed8', '#101827')
    expect(contrastRatio(accent, '#101827')).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('reaches a lower target with less adjustment', () => {
    // The non-text threshold is what the filled-button boundary uses; it must not
    // darken as far as body text would.
    const text = readableAccent('#febd69', undefined, AA_BODY)
    const edge = readableAccent('#febd69', undefined, AA_NON_TEXT)
    expect(contrastRatio(edge, SURFACE)).toBeGreaterThanOrEqual(AA_NON_TEXT)
    expect(contrastRatio(edge, SURFACE)).toBeLessThan(contrastRatio(text, SURFACE))
  })

  it('gives a near-white secondary colour a boundary that is actually visible', () => {
    // #f5f5f4 is a real branding value in this repo's dev data: filled with it, a
    // button was indistinguishable from the page.
    const edge = readableAccent('#f5f5f4', undefined, AA_NON_TEXT)
    expect(contrastRatio(edge, '#f5f5f4')).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(readableAccent('not-a-colour')).toBe('not-a-colour')
  })

  it('defaults to the AAA target, on every surface the app paints it on', () => {
    // This is the half of 1.4.6 the app can actually deliver: a DERIVED colour can
    // always be darkened to 7:1, unlike the two fixed inks readableInk chooses
    // between. If this drops back to 4.5 the AAA claim in
    // docs/guides/accessibility.md becomes false.
    for (const brand of ['#febd69', '#ca8a04', '#0ea5e9', '#16a34a', '#e11d48', '#f5f5f4']) {
      const accent = readableAccent(brand)
      for (const surface of ['#ffffff', '#f8fafc', '#f1f5f9']) {
        expect(contrastRatio(accent, surface), `${brand} on ${surface}`).toBeGreaterThanOrEqual(AAA_BODY)
      }
    }
  })

  it('still leaves a colour alone when it already clears 7:1', () => {
    // The shipped primary is dark enough that raising the target changed nothing —
    // which is the point: the cost of AAA falls only on pale brands.
    expect(readableAccent('#131921')).toBe('#131921')
  })
})

describe('meetsAaaBody', () => {
  it('is true only where one of the two inks actually reaches 7:1', () => {
    expect(meetsAaaBody('#131921')).toBe(true)  // 17.67 with white
    expect(meetsAaaBody('#febd69')).toBe(true)  // 10.74 with the dark ink
  })

  it('is false across the mid-tone band, which is why 1.4.6 is out of scope', () => {
    // Neither near-black nor white gets there. These are not exotic choices —
    // they are the default 600-weight of four common palettes. There is no fix
    // available to the app: the background is the operator's brand.
    expect(meetsAaaBody('#1d4ed8')).toBe(false) // 6.70
    expect(meetsAaaBody('#0ea5e9')).toBe(false) // 6.41
    expect(meetsAaaBody('#ca8a04')).toBe(false) // 6.05
    expect(meetsAaaBody('#16a34a')).toBe(false) // 5.39
  })

  it('is stricter than meetsAaBody, never looser', () => {
    for (const c of ['#131921', '#febd69', '#ca8a04', '#7b7b7b', '#ffffff', '#000000']) {
      if (meetsAaaBody(c)) expect(meetsAaBody(c), c).toBe(true)
    }
  })
})

describe('accentRamp', () => {
  // The chart palette. Every branding colour in this repo's own data, plus the two
  // hostile extremes, because the ramp is painted on top of whatever an operator saved.
  const COLOURS = ['#131921', '#febd69', '#ca8a04', '#1d4ed8', '#f5f5f4', '#000000', '#ffffff']

  it('returns exactly as many tones as asked for', () => {
    expect(accentRamp('#1d4ed8', 6)).toHaveLength(6)
    expect(accentRamp('#1d4ed8', 1)).toHaveLength(1)
    expect(accentRamp('#1d4ed8', 0)).toEqual([])
  })

  it('keeps every tone above the 1.4.11 floor, whatever the operator picked', () => {
    // The whole point: a chart segment is a non-text UI element, so 3:1 against the
    // card it sits on is required — and a pale brand colour would otherwise be
    // invisible for the lighter half of the ramp.
    for (const colour of COLOURS) {
      for (const tone of accentRamp(colour, 6)) {
        expect(contrastRatio(tone, SURFACE), `${colour} → ${tone}`).toBeGreaterThanOrEqual(
          AA_NON_TEXT - 0.01,
        )
        // Cards are white; the body is slate-50. All three surfaces must hold.
        expect(contrastRatio(tone, '#ffffff'), `${colour} → ${tone} on white`).toBeGreaterThanOrEqual(
          AA_NON_TEXT - 0.01,
        )
      }
    }
  })

  it('steps monotonically from dark to light, so the order carries magnitude', () => {
    for (const colour of COLOURS) {
      const ratios = accentRamp(colour, 6).map((tone) => contrastRatio(tone, SURFACE))
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i], `${colour} step ${i}`).toBeLessThan(ratios[i - 1])
      }
    }
  })

  it('separates adjacent tones enough to be told apart', () => {
    // A ramp whose steps collapse to the same tone encodes nothing. Contrast is the
    // proxy for lightness distance here; a ratio gap under 1.0 reads as one colour.
    for (const colour of COLOURS) {
      const ratios = accentRamp(colour, 6).map((tone) => contrastRatio(tone, SURFACE))
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i - 1] - ratios[i], `${colour} step ${i}`).toBeGreaterThan(0.8)
      }
    }
  })

  it('produces a real ramp where readableAccent could not', () => {
    // readableAccent returns a colour that already clears its target unchanged, so
    // six calls to it would yield six identical tones. This is why the ramp exists.
    const tones = accentRamp('#131921', 6)
    expect(new Set(tones).size).toBe(6)
  })

  it('is deterministic, so two renders paint the same chart', () => {
    expect(accentRamp('#ca8a04', 6)).toEqual(accentRamp('#ca8a04', 6))
  })

  it('falls back to the input colour when it cannot be parsed', () => {
    // A broken branding value must not blank the chart out.
    expect(accentRamp('not-a-colour', 3)).toEqual(['not-a-colour', 'not-a-colour', 'not-a-colour'])
  })
})
