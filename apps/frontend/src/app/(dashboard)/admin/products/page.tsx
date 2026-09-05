import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Role, Product, Category } from '@open-hybrid-cloud/types'
import { get } from '@/lib/serverApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { Table } from '@/components/ui/Table'
import { ButtonLink } from '@/components/ui/Button'
import { ProductRowActions } from './ProductRowActions'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function AdminProductsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const lang = await getLang()

  const [productsRes, categoriesRes] = await Promise.allSettled([
    get<Product[]>(`/api/admin/products?lang=${lang}`),
    get<Category[]>('/api/admin/categories'),
  ])

  const products = productsRes.status === 'fulfilled' ? (productsRes.value ?? []) : []
  const categories = categoriesRes.status === 'fulfilled' ? (categoriesRes.value ?? []) : []

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('productsTitle', lang)}
        subtitle={t('manageCatalogProducts', lang)}
        actions={
          <ButtonLink href="/admin/products/new">{t('newProduct', lang)}</ButtonLink>
        }
      />

      <Table<Product>
        columns={[
          {
            header: t('name', lang),
            render: (row) => (
              <span className="flex items-center gap-2">
                <Link href={`/admin/products/${row.id}`} className="font-medium text-blue-600 hover:underline">
                  {row.name}
                </Link>
                {/* Withdrawn products are LISTED here, marked — this is the only
                    screen they can be brought back from, and hiding them is what
                    made retirement a one-way trapdoor (#251). The catalogue still
                    filters them out, which is the filter that was always meant.

                    A badge and not a colour: the state has to survive being read
                    aloud, and greying the row would say it to nobody else. */}
                {row.retiredAt && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {t('disabledBadge', lang)}
                  </span>
                )}
              </span>
            ),
          },
          {
            header: t('category', lang),
            render: (row) => catMap[row.categoryId] ?? `#${row.categoryId}`,
          },
          { header: t('language', lang), accessor: 'baseLanguage' },
          {
            header: t('created', lang),
            render: (row) => (
              <span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleDateString(lang)}</span>
            ),
          },
          {
            header: '',
            className: 'text-right',
            render: (row) => <ProductRowActions product={row} />,
          },
        ]}
        data={products}
        emptyMessage={t('noProductsYet', lang)}
      />
    </div>
  )
}
