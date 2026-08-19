import { describe, it, expect } from 'vitest'
import { parseHex, contrastRatio, readableInk, meetsAaBody, AA_BODY, readableAccent, SURFACE, AA_NON_TEXT } from './contrast'

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
})
