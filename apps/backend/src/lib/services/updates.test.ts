import { describe, it, expect } from 'vitest'
import { isEmptyUpdate } from './updates'

describe('isEmptyUpdate', () => {
  it('is true for the body Zod produces from {}', () => {
    expect(isEmptyUpdate({})).toBe(true)
  })

  it('is true when every field is undefined', () => {
    // What a caller that spreads optional fields produces, and what Drizzle drops.
    expect(isEmptyUpdate({ name: undefined, active: undefined })).toBe(true)
  })

  it('is false for a single named field', () => {
    expect(isEmptyUpdate({ name: 'x' })).toBe(false)
  })

  it('is false for falsy-but-present values', () => {
    expect(isEmptyUpdate({ active: false })).toBe(false)
    expect(isEmptyUpdate({ name: '' })).toBe(false)
    expect(isEmptyUpdate({ displayOrder: 0 })).toBe(false)
    // An explicit null is a request to clear the column, not an absent field.
    expect(isEmptyUpdate({ environmentId: null })).toBe(false)
  })
})
