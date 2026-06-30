import { describe, it, expect, beforeEach } from 'vitest'
import {
  getBranding,
  updateBranding,
  getBrandingLogo,
  updateBrandingLogo,
} from './branding'
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

// The `branding` row with id=1 is seeded once in beforeAll, but the table is
// not in the TRUNCATE list — so the row persists across tests. Reset it here
// to keep tests isolated.
beforeEach(async () => {
  await db.execute(sql`
    UPDATE branding SET
      logo_data = NULL, logo_mime = NULL,
      primary_color = '#1e40af', secondary_color = '#3b82f6',
      shop_name = 'Open Hybrid Cloud', shop_subtitle = '', imprint_text = ''
    WHERE id = 1
  `)
})

describe('getBranding', () => {
  it('returns the default seed values', async () => {
    const result = await getBranding()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.primaryColor).toBe('#1e40af')
      expect(result.data.secondaryColor).toBe('#3b82f6')
      expect(result.data.shopName).toBe('Open Hybrid Cloud')
      expect(result.data.shopSubtitle).toBe('')
      expect(result.data.imprintText).toBe('')
      expect(result.data.logoMime).toBeNull()
    }
  })
})

describe('updateBranding', () => {
  it('persists changes; getBranding reflects them', async () => {
    const updated = await updateBranding({
      primaryColor: '#000000',
      shopName: 'My Shop',
      imprintText: 'Imprint',
    })
    expect(updated.ok).toBe(true)

    const result = await getBranding()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.primaryColor).toBe('#000000')
      expect(result.data.shopName).toBe('My Shop')
      expect(result.data.imprintText).toBe('Imprint')
    }
  })
})

describe('getBrandingLogo', () => {
  it('returns null when no logo set', async () => {
    const result = await getBrandingLogo()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBeNull()
  })
})

describe('updateBrandingLogo', () => {
  it('stores the buffer and mime; getBrandingLogo returns them', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const setRes = await updateBrandingLogo(buf, 'image/png')
    expect(setRes.ok).toBe(true)

    const result = await getBrandingLogo()
    expect(result.ok).toBe(true)
    if (result.ok && result.data) {
      expect(Buffer.from(result.data.data).equals(buf)).toBe(true)
      expect(result.data.mime).toBe('image/png')
    }
  })
})
