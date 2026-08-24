import { get } from '@/lib/api'
import type { Branding } from '@open-hybrid-cloud/types'
import Link from 'next/link'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function ImpressumPage() {
  const lang = await getLang()

  let branding: Partial<Branding> = {}
  try {
    branding = (await get<Partial<Branding>>('/api/public/branding')) ?? {}
  } catch {
    /* non-fatal */
  }

  const shopName = branding.shopName ?? 'Open Hybrid Cloud'
  const imprintText = branding.imprintText ?? ''

  // The empty state is a page in its own right, not a placeholder: it is what
  // /impressum serves on every install where the operator has not filled the
  // imprint in, which is the default. It used to be a bare centred <div> — no
  // <main>, no <h1> — so it failed `landmark-one-main`, `page-has-heading-one`
  // and `region`, none of which the gate requested. The populated branch below
  // already had both; only this one was missed.
  if (!imprintText) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <main className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('imprint', lang)}</h1>
          <p className="text-slate-600">{t('noImprintConfigured', lang)}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-slate-800">{shopName}</span>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← {t('back', lang)}</Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">{t('imprint', lang)}</h1>
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {imprintText}
        </div>
      </main>
    </div>
  )
}
