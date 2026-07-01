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
): { amount: string; currency: string } {
  if (fromCurrency === toCurrency) return { amount: price, currency: toCurrency }

  const numPrice = parseFloat(price)
  if (isNaN(numPrice)) return { amount: price, currency: fromCurrency }

  // rates are relative to EUR; convert from→EUR→to
  const fromRate = fromCurrency === 'EUR' ? 1 : (rates[fromCurrency] ?? 1)
  const toRate = toCurrency === 'EUR' ? 1 : (rates[toCurrency] ?? null)

  if (toRate === null) return { amount: price, currency: fromCurrency }

  const eur = numPrice / fromRate
  const converted = eur * toRate
  return {
    amount: converted.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    currency: toCurrency,
  }
}
