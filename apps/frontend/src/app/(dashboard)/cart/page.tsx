import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import type { CartItem, Project, CostCenter } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { CartView } from './CartView'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

// The cart is per user and changes on every add, so it must never be cached.
export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  const [cartRes, projectsRes, costCentersRes] = await Promise.allSettled([
    get<CartItem[]>('/api/cart', token),
    get<Project[]>('/api/projects', token),
    get<CostCenter[]>('/api/admin/cost-centers', token),
  ])

  const items = cartRes.status === 'fulfilled' ? (cartRes.value ?? []) : []
  const projects = projectsRes.status === 'fulfilled' ? (projectsRes.value ?? []) : []
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title={t('cart', lang)} subtitle={t('cartCheckoutHint', lang)} />
      <CartView
        initialItems={items}
        projects={projects}
        costCenters={costCenters}
        token={token}
        lang={lang}
      />
    </div>
  )
}
