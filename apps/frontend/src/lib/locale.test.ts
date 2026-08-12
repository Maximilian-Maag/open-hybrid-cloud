import { describe, it, expect } from 'vitest'
import { convertPrice, localeToCurrency } from './locale'

const rates = { USD: 1.1, GBP: 0.85 } // relative to EUR

describe('convertPrice', () => {
  it('formats the amount in the locale when currencies match', () => {
    // Same currency: no conversion, but still format grouping/decimals.
    expect(convertPrice('100', 'EUR', 'EUR', rates)).toEqual({ amount: '100.00', currency: 'EUR' })
    expect(convertPrice('1234.5', 'EUR', 'EUR', rates, 'en')).toEqual({ amount: '1,234.50', currency: 'EUR' })
    expect(convertPrice('1234.5', 'EUR', 'EUR', rates, 'de')).toEqual({ amount: '1.234,50', currency: 'EUR' })
  })

  it('returns the raw price for a non-numeric input when currencies match', () => {
    expect(convertPrice('n/a', 'EUR', 'EUR', rates, 'de')).toEqual({ amount: 'n/a', currency: 'EUR' })
  })

  it('converts EUR → USD via the rate', () => {
    const res = convertPrice('100', 'EUR', 'USD', rates)
    expect(res.currency).toBe('USD')
    // 100 EUR * 1.1 = 110.00 (en formatting)
    expect(res.amount).toBe('110.00')
  })

  it('formats grouping/decimals in the requested locale', () => {
    const en = convertPrice('1000', 'EUR', 'USD', rates, 'en')
    const de = convertPrice('1000', 'EUR', 'USD', rates, 'de')
    // 1000 * 1.1 = 1100
    expect(en.amount).toBe('1,100.00')
    expect(de.amount).toBe('1.100,00')
  })

  it('falls back to the source price when the target rate is unknown', () => {
    expect(convertPrice('100', 'EUR', 'JPY', rates)).toEqual({ amount: '100', currency: 'EUR' })
  })

  it('returns the raw price for a non-numeric input', () => {
    expect(convertPrice('n/a', 'EUR', 'USD', rates)).toEqual({ amount: 'n/a', currency: 'EUR' })
  })
})

describe('localeToCurrency', () => {
  it('maps known locales to their currency', () => {
    expect(localeToCurrency('de')).toBe('EUR')
    expect(localeToCurrency('pl')).toBe('PLN')
    expect(localeToCurrency('sv')).toBe('SEK')
  })

  it('defaults to EUR for unknown locales', () => {
    expect(localeToCurrency('zz')).toBe('EUR')
  })
})
