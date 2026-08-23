import { describe, it, expect } from 'vitest'
import { integrationBaseUrl } from './baseUrl'

const parse = (value: string) => integrationBaseUrl().safeParse(value)
const messages = (value: string) =>
  parse(value).error?.issues.map((i) => i.message).join(' | ') ?? ''

describe('integrationBaseUrl', () => {
  it.each([
    'https://foreman.example.com',
    'http://localhost:3000',
    'https://gw.example.com/foreman',
    'https://gw.example.com/foreman/',
  ])('accepts %s', (value) => {
    expect(parse(value).success).toBe(true)
  })

  it('rejects a URL with embedded credentials', () => {
    // The base URL is stored, returned by every read path and interpolated into
    // the audit label, so this would put a password in both.
    expect(parse('https://svc:hunter2@foreman.example.com').success).toBe(false)
    expect(messages('https://svc:hunter2@foreman.example.com')).toMatch(/must not embed credentials/)
  })

  it('rejects userinfo even without a password', () => {
    expect(parse('https://svc@foreman.example.com').success).toBe(false)
  })

  it('rejects a query string, which the probe would fold into its health path', () => {
    expect(parse('https://foreman.example.com?foo=1').success).toBe(false)
    expect(messages('https://foreman.example.com?foo=1')).toMatch(/query string/)
  })

  it('rejects a fragment', () => {
    expect(parse('https://foreman.example.com#frag').success).toBe(false)
  })

  it.each(['file:///etc/passwd', 'data:text/plain,hi', 'ftp://example.com'])(
    'rejects the %s scheme',
    (value) => {
      expect(parse(value).success).toBe(false)
    },
  )

  it('still rejects something that is not a URL at all', () => {
    expect(parse('not a url').success).toBe(false)
  })
})
