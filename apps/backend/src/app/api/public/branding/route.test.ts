import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from './route'
import { updateBranding } from '@/lib/services/admin/branding'
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

// The `branding` row with id=1 is seeded once in beforeAll and is not in the
// TRUNCATE list, so mutations leak across tests unless we reset it here.
beforeEach(async () => {
  await db.execute(sql`
    UPDATE branding SET
      logo_data = NULL, logo_mime = NULL,
      primary_color = '#1e40af', secondary_color = '#3b82f6',
      shop_name = 'Open Hybrid Cloud', shop_subtitle = '', imprint_text = ''
    WHERE id = 1
  `)
})

// FA-15.3: /impressum is publicly accessible without auth. The Impressum page reads
// the imprint text from /api/public/branding, so that endpoint must:
//   - not require authentication
//   - expose the imprintText field
describe('GET /api/public/branding (FA-15.3)', () => {
  it('returns 200 without any authentication', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('exposes imprintText so /impressum can render the imprint', async () => {
    await updateBranding({ imprintText: 'Some imprint text — legally required.' })
    const res = await GET()
    const body = await res.json()
    expect(body.imprintText).toBe('Some imprint text — legally required.')
  })

  it('does not leak sensitive columns (logo_data, id)', async () => {
    const res = await GET()
    const body = await res.json()
    // The public response only exposes display fields; raw logo bytes and internal id are not present
    expect(body).not.toHaveProperty('logoData')
    expect(body).not.toHaveProperty('logo_data')
    expect(body).not.toHaveProperty('id')
  })
})
