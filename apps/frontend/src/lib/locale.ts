// Maps BCP-47 language subtag → ISO 4217 currency code for EU + Russia
const LOCALE_CURRENCY: Record<string, string> = {
  bg: 'BGN', // Bulgarian lev
  cs: 'CZK', // Czech koruna
  da: 'DKK', // Danish krone
  de: 'EUR',
  el: 'EUR',
  en: 'EUR',
  es: 'EUR',
  et: 'EUR',
  fi: 'EUR',
  fr: 'EUR',
  ga: 'EUR',
  hr: 'EUR', // Croatia joined Eurozone 2023
  hu: 'HUF', // Hungarian forint
  it: 'EUR',
  lt: 'EUR',
  lv: 'EUR',
  mt: 'EUR',
  nl: 'EUR',
  pl: 'PLN', // Polish zloty
  pt: 'EUR',
  ro: 'RON', // Romanian leu
  ru: 'RUB', // Russian ruble
  sk: 'EUR',
  sl: 'EUR',
  sv: 'SEK', // Swedish krona
}

export function localeToCurrency(locale: string): string {
  const lang = locale.split('-')[0].toLowerCase()
  return LOCALE_CURRENCY[lang] ?? 'EUR'
}

export function convertPrice(
  price: string,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number>,
  locale = 'en',
): { amount: string; currency: string } {
  if (fromCurrency === toCurrency) {
    const sameNum = parseFloat(price)
    if (isNaN(sameNum)) return { amount: price, currency: toCurrency }
    return {
      // Format grouping/decimals in the user's locale (e.g. 1.234,50 for de).
      amount: sameNum.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      currency: toCurrency,
    }
  }

  const numPrice = parseFloat(price)
  if (isNaN(numPrice)) return { amount: price, currency: fromCurrency }

  // rates are relative to EUR; convert from→EUR→to
  const fromRate = fromCurrency === 'EUR' ? 1 : (rates[fromCurrency] ?? 1)
  const toRate = toCurrency === 'EUR' ? 1 : (rates[toCurrency] ?? null)

  if (toRate === null) return { amount: price, currency: fromCurrency }

  const eur = numPrice / fromRate
  const converted = eur * toRate
  return {
    // Format grouping/decimals in the user's locale (e.g. 1.234,56 for de).
    amount: converted.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    currency: toCurrency,
  }
}

/**
 * What an amount is worth in EUR, or null when nothing says.
 *
 * Rates are quoted against EUR, so EUR itself is 1 by definition and carries no
 * entry of its own. Null both for a currency with no rate and for a price that
 * does not parse: "not comparable" is a different answer from a number, and the
 * callers below rely on being able to tell the two apart.
 */
export function priceInEur(
  price: string,
  currency: string,
  rates: Record<string, number>,
): number | null {
  const amount = parseFloat(price)
  if (isNaN(amount)) return null
  if (currency === 'EUR') return amount
  const rate = rates[currency]
  // A zero rate is treated as missing rather than divided by: it converts every
  // amount to Infinity, which is not a price.
  return rate ? amount / rate : null
}

/**
 * Amounts ordered cheapest first by what they are WORTH, not by the digits.
 *
 * Sizes each carry their own currency (issue #98), so sorting on the bare number
 * ranks 10 USD below 9 EUR — and the first entry is what the catalogue presents
 * to a shopper as "the price" and what the price range is drawn from.
 *
 * An amount whose currency has no rate sorts LAST rather than being assumed 1:1
 * with EUR. An invented rate would put a wrong figure in front of a shopper as
 * the cheapest; sorting it last can only ever understate that amount's position
 * and never makes the claim. The sort is stable, so equal and incomparable
 * amounts keep the order the catalogue defined them in.
 */
export function sortByValue<T extends { price: string; currency: string }>(
  amounts: readonly T[],
  rates: Record<string, number>,
): T[] {
  return [...amounts].sort((a, b) => {
    const aEur = priceInEur(a.price, a.currency, rates)
    const bEur = priceInEur(b.price, b.currency, rates)
    if (aEur === null) return bEur === null ? 0 : 1
    if (bEur === null) return -1
    return aEur - bEur
  })
}
