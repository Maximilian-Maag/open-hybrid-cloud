import { get } from '@/lib/api'
import type { Branding } from '@open-hybrid-cloud/types'
import Link from 'next/link'

export default async function ImpressumPage() {
  let branding: Partial<Branding> = {}
  try {
    branding = (await get<Partial<Branding>>('/api/public/branding')) ?? {}
  } catch {
    /* non-fatal */
  }

  const shopName = branding.shopName ?? 'Open Hybrid Cloud'
  const imprintText = branding.imprintText ?? ''

  if (!imprintText) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center text-slate-400">No imprint configured.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-slate-800">{shopName}</span>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Imprint</h1>
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {imprintText}
        </div>
      </main>
    </div>
  )
}
