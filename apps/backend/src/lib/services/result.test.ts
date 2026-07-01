import { describe, it, expect } from 'vitest'
import { ok, err, type Result } from './result'

describe('ok', () => {
  it('returns an Ok result wrapping the value', () => {
    const result = ok(42)
    expect(result).toEqual({ ok: true, data: 42 })
  })

  it('preserves complex object values', () => {
    const value = { a: 1, b: [1, 2, 3], c: { nested: true } }
    const result = ok(value)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBe(value)
    }
  })

  it('allows undefined values', () => {
    const result = ok(undefined)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBeUndefined()
    }
  })
})

describe('err', () => {
  it('returns an Err result with status and message', () => {
    const result = err(404, 'Not found')
    expect(result).toEqual({ ok: false, status: 404, message: 'Not found' })
  })

  it('supports any HTTP status code', () => {
    const result = err(500, 'Server error')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.message).toBe('Server error')
    }
  })
})

describe('Result type narrowing', () => {
  it('narrows to Ok when result.ok is true', () => {
    const result: Result<string> = ok('hello')
    if (result.ok) {
      // TS should accept .data access here
      expect(result.data.toUpperCase()).toBe('HELLO')
    } else {
      // Should never reach here
      expect.fail('result was not Ok')
    }
  })

  it('narrows to Err when result.ok is false', () => {
    const result: Result<string> = err(400, 'bad request')
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toBe('bad request')
    } else {
      expect.fail('result was not Err')
    }
  })
})
