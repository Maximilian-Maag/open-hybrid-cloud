import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { t, type Translations } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

/**
 * The eleven admin sections, keyed rather than written out in English.
 *
 * Each pair is the SAME key the section's own page passes to its `PageHeader`,
 * so the card and the page it opens can no longer disagree. Before this the
 * eleven titles and eleven descriptions were English literals under a translated
 * `PageHeader` — 22 untagged strings inside a document declaring another
 * language (WCAG 3.1.2), and the translated header above them made it look
 * deliberate. No new keys were needed: all 22 already existed for the pages.
 */
const adminSections: { href: string; title: keyof Translations; description: keyof Translations }[] = [
  { href: '/admin/categories', title: 'categories', description: 'categoriesSubtitle' },
  { href: '/admin/products', title: 'productsTitle', description: 'manageCatalogProducts' },
  { href: '/admin/environments', title: 'environments', description: 'environmentsSubtitle' },
  { href: '/admin/ci-sources', title: 'ciSources', description: 'ciSourcesSubtitle' },
  { href: '/admin/cost-centers', title: 'costCenters', description: 'costCentersSubtitle' },
  { href: '/admin/users', title: 'users', description: 'usersSubtitle' },
  { href: '/admin/parameters', title: 'globalParameters', description: 'globalParametersSubtitle' },
  { href: '/admin/branding', title: 'branding', description: 'brandingSubtitle' },
  { href: '/admin/config/smtp', title: 'smtpConfiguration', description: 'smtpSubtitle' },
  { href: '/admin/config/ai', title: 'aiConfiguration', description: 'aiSubtitle' },
  { href: '/admin/exchange-rates', title: 'exchangeRates', description: 'exchangeRatesSubtitle' },
]

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/')

  const lang = await getLang()

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title={t('adminDashboard', lang)} subtitle={t('adminDashboardSubtitle', lang)} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminSections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
          >
            {/* h2, not h3: the only heading above these is the PageHeader's h1,
                so an h3 skipped a level on the root admin landing page. */}
            <h2 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors mb-1">
              {t(section.title, lang)}
            </h2>
            <p className="text-sm text-slate-500">{t(section.description, lang)}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
