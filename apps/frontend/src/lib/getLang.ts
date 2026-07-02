import { cookies, headers } from 'next/headers'
import { isValidLang } from './i18n'

export async function getLang(): Promise<string> {
  const cookieStore = cookies()
  const langCookie = cookieStore.get('lang')?.value
  if (langCookie && isValidLang(langCookie)) return langCookie

  const hdrs = headers()
  const acceptLang = hdrs.get('accept-language') ?? ''
  const primary = acceptLang.split(',')[0]?.split(';')[0]?.trim() ?? 'en'
  const code = primary.split('-')[0].toLowerCase()
  if (isValidLang(code)) return code
  return 'en'
}
