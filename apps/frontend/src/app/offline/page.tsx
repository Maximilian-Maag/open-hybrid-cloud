import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'
import { OfflineRetry } from './OfflineRetry'

/**
 * What the installed app shows when the network is gone (#148).
 *
 * Precached by the service worker at install, and served for any navigation
 * that cannot reach the network. It is deliberately the ONLY thing cached that
 * a person reads: every other page in this portal is user- and role-scoped, and
 * a cached one served to the next session on a shared device would hand one
 * person's orders to another.
 *
 * So this page states what is unavailable rather than pretending to be the app.
 * It carries no data, and it says plainly that writes need a connection —
 * offline writes are out of scope (see the note in `public/sw.js` about why
 * Background Sync would be worse than nothing here).
 *
 * A page, so the accessibility gate scans it and the language sweep checks its
 * strings like any other.
 */
export const metadata = { title: 'Offline' }

export default async function OfflinePage() {
  const lang = await getLang()

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        {/* Decorative: the heading below already says this in words, and a
            screen reader announcing "antenna" adds nothing. */}
        <div aria-hidden="true" className="mb-4 text-4xl">⚠</div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('offlineTitle', lang)}</h1>
        <p className="mt-3 text-sm text-slate-600">{t('offlineBody', lang)}</p>
        <div className="mt-6">
          <OfflineRetry label={t('offlineRetry', lang)} />
        </div>
      </div>
    </main>
  )
}
