import { describe, it, expect, vi, afterEach } from 'vitest'
import manifest from './manifest'
import { buildIcon } from './icon.svg/route'

/**
 * The manifest and the icons an operator's branding produces (#148).
 *
 * The value here is that these are GENERATED. A static `public/manifest.json`
 * would carry one deployment's name and colours to every other one, which is
 * the reason the issue rules it out.
 */
afterEach(() => vi.restoreAllMocks())

const branded = (over: Record<string, unknown> = {}) =>
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      shopName: 'Acme Cloud Platform', shopSubtitle: 'Infrastructure on tap',
      primaryColor: '#123456', secondaryColor: '#abcdef', logoMime: null, ...over,
    }), { headers: { 'content-type': 'application/json' } }),
  )

describe('manifest', () => {
  it('takes its name and colours from the operator, not from a constant', async () => {
    branded()
    const m = await manifest()

    expect(m.name).toBe('Acme Cloud Platform')
    expect(m.theme_color).toBe('#123456')
    expect(m.background_color).toBe('#123456')
    expect(m.description).toBe('Infrastructure on tap')
  })

  // Home screens truncate at roughly twelve characters, and a name that is cut
  // off mid-word under an icon is worse than a short one.
  it('shortens a long name for the home screen', async () => {
    branded()
    const m = await manifest()
    expect(m.short_name?.length ?? Infinity).toBeLessThanOrEqual(12)
    expect(m.short_name).toBe('Acme Cloud')
  })

  it('declares what installability needs', async () => {
    branded()
    const m = await manifest()

    expect(m.display).toBe('standalone')
    // The dashboard, not /login: an installed app that opens on a sign-in page
    // even with a good session reads as broken.
    expect(m.start_url).toBe('/')
    expect(m.icons?.some((i) => i.purpose === 'any')).toBe(true)
    // Android crops to the launcher's shape; without a maskable variant the
    // plain icon loses its corners.
    expect(m.icons?.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('is still installable when branding cannot be read', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('backend down'))
    const m = await manifest()
    expect(m.name).toBe('Open Hybrid Cloud')
    expect(m.display).toBe('standalone')
  })
})

describe('buildIcon', () => {
  it('embeds the uploaded logo rather than linking it', async () => {
    const svg = buildIcon({
      name: 'Acme', background: '#123456', ink: '#ffffff',
      logo: 'data:image/png;base64,AAAA', safeZone: 0.12,
    })
    // One request that cannot half-fail, and nothing to fetch when a launcher
    // rasterises it.
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"')
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"')
  })

  it('falls back to the initials on the brand colour', () => {
    const svg = buildIcon({ name: 'Open Hybrid Cloud', background: '#123456', ink: '#ffffff', logo: null, safeZone: 0.12 })
    expect(svg).toContain('>OH<')
    expect(svg).toContain('fill="#123456"')
    expect(svg).toContain('fill="#ffffff"')
  })

  /*
   * The shop name reaches the SVG as an accessible label. Operator text going
   * into markup: a name with a quote in it would otherwise close the attribute
   * and the rest would parse as elements.
   */
  it('escapes the operator’s name into the label', () => {
    const svg = buildIcon({ name: 'A"B<C', background: '#000000', ink: '#ffffff', logo: null, safeZone: 0.12 })
    expect(svg).toContain('aria-label="A&quot;B&lt;C"')
    expect(svg).not.toContain('aria-label="A"B')
  })

  // The background covers the whole canvas at both insets; only the artwork
  // moves. A maskable icon whose BACKGROUND was inset shows white corners the
  // moment a launcher crops it to a circle.
  it.each([0.12, 0.2])('paints the background edge to edge at inset %s', (safeZone) => {
    const svg = buildIcon({ name: 'Acme', background: '#123456', ink: '#fff', logo: null, safeZone })
    expect(svg).toContain('<rect width="512" height="512" fill="#123456"/>')
  })

  it('insets the artwork further for the maskable variant', () => {
    const plain = buildIcon({ name: 'A', background: '#000', ink: '#fff', logo: 'data:image/png;base64,AA', safeZone: 0.12 })
    const masked = buildIcon({ name: 'A', background: '#000', ink: '#fff', logo: 'data:image/png;base64,AA', safeZone: 0.2 })
    const width = (svg: string) => {
      const m = /<image[^>]*width="(\d+)"/.exec(svg)
      if (!m) throw new Error('no <image> in the icon')
      return Number(m[1])
    }
    expect(width(masked)).toBeLessThan(width(plain))
  })
})
