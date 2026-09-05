import { describe, it, expect, vi, afterEach } from 'vitest'
import { readBranding, readLogoDataUri, initialsOf, xmlEscape, shortNameFor, FALLBACK } from './pwaBranding'

/**
 * The branding an installed app shows (#148).
 *
 * A manifest that 500s makes the app uninstallable; a manifest with the default
 * name does not. Every failure here has to degrade rather than throw, which is
 * most of what these assert.
 */
afterEach(() => vi.restoreAllMocks())

const jsonOnce = (body: unknown, ok = true) =>
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } }),
  )

describe('readBranding', () => {
  it('takes the operator’s name and colours', async () => {
    jsonOnce({ shopName: 'Acme Cloud', shopSubtitle: 'Infra', primaryColor: '#123456', secondaryColor: '#abcdef', logoMime: 'image/png' })

    expect(await readBranding()).toEqual({
      shopName: 'Acme Cloud', shopSubtitle: 'Infra',
      primaryColor: '#123456', secondaryColor: '#abcdef', logoMime: 'image/png',
    })
  })

  it.each([
    ['the endpoint errors', () => jsonOnce({}, false)],
    ['the fetch throws', () => vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'))],
  ])('falls back to defaults when %s', async (_name, arrange) => {
    arrange()
    // Not a throw: an uninstallable app is a worse outcome than a default name.
    expect(await readBranding()).toEqual(FALLBACK)
  })

  // An operator who blanks the shop name has not asked for an app called "".
  it('treats a blank name or subtitle as absent', async () => {
    jsonOnce({ shopName: '   ', shopSubtitle: '', primaryColor: '#111111', secondaryColor: '#222222', logoMime: null })
    const b = await readBranding()
    expect(b.shopName).toBe(FALLBACK.shopName)
    expect(b.shopSubtitle).toBe(FALLBACK.shopSubtitle)
    // But the colours they DID set are kept.
    expect(b.primaryColor).toBe('#111111')
  })
})

describe('readLogoDataUri', () => {
  it('is null when no logo was uploaded, without asking', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    expect(await readLogoDataUri(null)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('inlines the logo so the icon is one request that cannot half fail', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    expect(await readLogoDataUri('image/png')).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`)
  })

  // A row whose mime is set but whose bytes are empty would otherwise produce
  // `data:image/png;base64,` — a broken image inside the launcher icon.
  it('is null when the logo body is empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array([])))
    expect(await readLogoDataUri('image/png')).toBeNull()
  })

  it('is null rather than throwing when the logo cannot be read', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('gone'))
    expect(await readLogoDataUri('image/png')).toBeNull()
  })
})

describe('initialsOf', () => {
  it.each([
    ['Open Hybrid Cloud', 'OH'],
    ['Acme', 'AC'],
    ['a', 'A'],
    ['  spaced   out  ', 'SO'],
    ['', '?'],
    ['   ', '?'],
  ])('%s -> %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected)
  })
})

describe('xmlEscape', () => {
  /*
   * The shop name is operator-supplied text going into an SVG document. Without
   * escaping, a name containing a quote or a bracket closes the attribute it
   * sits in and the rest is parsed as markup.
   */
  it('escapes every character that would break out of an attribute', () => {
    expect(xmlEscape(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
  })

  it('escapes the ampersand first, so an escape is not double-escaped', () => {
    // `&lt;` must not become `&amp;lt;`.
    expect(xmlEscape('a & b < c')).toBe('a &amp; b &lt; c')
  })
})

describe('shortNameFor', () => {
  it.each([
    ['Acme', 'Acme'],
    ['Acme Cloud Platform', 'Acme Cloud'],
    ['Open Hybrid Cloud', 'Open Hybrid'],
    // Nowhere better to cut a single long word.
    ['Supercalifragilistic', 'Supercalifra'],
  ])('%s -> %s', (name, expected) => {
    expect(shortNameFor(name)).toBe(expected)
  })

  it('never exceeds the budget', () => {
    for (const n of ['Acme Cloud Platform', 'A B C D E F G H', 'Wolkenplattform Nord']) {
      expect(shortNameFor(n).length).toBeLessThanOrEqual(12)
    }
  })
})
