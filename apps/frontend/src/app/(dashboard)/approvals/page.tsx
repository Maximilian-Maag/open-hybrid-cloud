import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import type { Order, Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { ApprovalRow } from './ApprovalRow'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function ApprovalsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'admin' && role !== 'root') redirect('/')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  let orders: Order[] = []
  try {
    const all = (await get<Order[]>('/api/orders', token)) ?? []
    orders = all.filter((o) => o.status === 'pending')
  } catch {
    /* empty */
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('approvals', lang)}
        subtitle={`${orders.length} ${t('ordersPendingApproval', lang)}`}
      />

      {orders.length === 0 ? (
        <div className="text-center py-12 text-slate-400">{t('noPendingOrders', lang)}</div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <ApprovalRow key={order.id} order={order} token={token} />
          ))}
        </div>
      )}
    </div>
  )
}
