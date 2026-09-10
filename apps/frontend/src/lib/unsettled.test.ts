import { describe, it, expect } from 'vitest'
import { hasUnsettled } from './unsettled'

describe('hasUnsettled', () => {
  it('is true only while something can still change on its own', () => {
    expect(hasUnsettled(['completed', 'failed', 'rejected'])).toBe(false)
    expect(hasUnsettled(['active', 'decommissioned'])).toBe(false)
    expect(hasUnsettled(['completed', 'provisioning'])).toBe(true)
    expect(hasUnsettled(['pending'])).toBe(true)
    expect(hasUnsettled(['active', 'decommissioning'])).toBe(true)
  })

  it('treats an empty list and missing values as settled', () => {
    expect(hasUnsettled([])).toBe(false)
    expect(hasUnsettled([undefined, null])).toBe(false)
  })
})
