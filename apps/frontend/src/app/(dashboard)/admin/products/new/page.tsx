import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role, Category } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'
import { PageHeader } from '@/components/layout/PageHeader'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { NewProductForm } from './NewProductForm'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default async function NewProductPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  let categories: Category[] = []
  try {
    categories = (await get<Category[]>('/api/admin/categories', token)) ?? []
  } catch { /* empty */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Breadcrumbs
        label={t('breadcrumb', lang)}
        items={[
          { label: t('admin', lang), href: '/admin' },
          { label: 'Products', href: '/admin/products' },
          { label: 'New Product' },
        ]}
      />
      <PageHeader
        title={t('newProduct', lang)}
        actions={
          <Link href="/admin/products">
            <Button variant="secondary" size="sm">{t('backToProducts', lang)}</Button>
          </Link>
        }
      />
      <NewProductForm categories={categories} token={token} />
    </div>
  )
}
