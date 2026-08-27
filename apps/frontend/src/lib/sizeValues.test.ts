import { describe, it, expect } from 'vitest'
import { sizeValuesToText, parseSizeValues } from './sizeValues'

/**
 * The per-size values of a `size` parameter, as an admin edits them: a map on
 * the wire, `CODE=value` per line in the box.
 */

describe('sizeValuesToText', () => {
  it('writes one line per size', () => {
    expect(sizeValuesToText({ S: 't3.micro', XL: 'm6i.2xlarge' })).toBe('S=t3.micro\nXL=m6i.2xlarge')
  })

  // Stable, so opening the editor twice does not reshuffle the box under the
  // person reading it — object key order is not something to rely on.
  it('sorts by code', () => {
    expect(sizeValuesToText({ XL: 'c', M: 'b', S: 'a' })).toBe('M=b\nS=a\nXL=c')
  })

  it('is empty for a parameter that has none', () => {
    expect(sizeValuesToText({})).toBe('')
    expect(sizeValuesToText(undefined)).toBe('')
  })
})

describe('parseSizeValues', () => {
  it('reads one line per size', () => {
    expect(parseSizeValues('S=t3.micro\nXL=m6i.2xlarge')).toEqual({ S: 't3.micro', XL: 'm6i.2xlarge' })
  })

  // Only the FIRST `=` splits. `user_data=KEY=VALUE` is a real thing to want,
  // and splitting on every one would silently truncate it.
  it('keeps an = inside the value', () => {
    expect(parseSizeValues('M=KEY=VALUE')).toEqual({ M: 'KEY=VALUE' })
  })

  it('trims either side', () => {
    expect(parseSizeValues('  S  =  t3.micro  ')).toEqual({ S: 't3.micro' })
  })

  /*
   * Half-typed input is dropped, not rejected. This runs on every keystroke, so
   * refusing a line the moment it lacks an `=` would fight the person typing it.
   * The server validates what is actually submitted.
   */
  it('ignores blank lines and lines with no separator', () => {
    expect(parseSizeValues('S=a\n\nnonsense\n   \nXL=b')).toEqual({ S: 'a', XL: 'b' })
  })

  it('ignores a line with an empty code', () => {
    expect(parseSizeValues('=orphan\nS=a')).toEqual({ S: 'a' })
  })

  // An empty value is kept rather than dropped: it is a size the admin has
  // started and not finished, and the order-time check names it explicitly.
  it('keeps a code whose value is still empty', () => {
    expect(parseSizeValues('S=')).toEqual({ S: '' })
  })

  it('round-trips', () => {
    const map = { M: 'b', S: 'a', XL: 'c' }
    expect(parseSizeValues(sizeValuesToText(map))).toEqual(map)
  })
})
