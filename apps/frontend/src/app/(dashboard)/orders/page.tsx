import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Order } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function OrdersPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  let orders: Order[] = []
  try {
    orders = (await get<Order[]>('/api/orders', token)) ?? []
  } catch {
    /* empty */
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title={t('orders', lang)} subtitle={t('ordersSubtitle', lang)} />

      <Table<Order>
        columns={[
          {
            header: t('id', lang),
            render: (row) => (
              <Link href={`/orders/${row.id}`} className="font-mono text-blue-600 hover:underline text-xs">
                #{row.id}
              </Link>
            ),
          },
          {
            header: t('product', lang),
            render: (row) => (
              <span className="font-medium text-slate-900">
                {row.productName ?? `Product #${row.productId}`}
              </span>
            ),
          },
          { header: t('environment', lang), accessor: 'environmentName' },
          { header: t('project', lang), accessor: 'projectName' },
          {
            header: t('status', lang),
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            header: t('date', lang),
            render: (row) => (
              <span className="text-xs text-slate-500">
                {new Date(row.createdAt).toLocaleDateString()}
              </span>
            ),
          },
        ]}
        data={orders}
        emptyMessage={t('noOrders', lang)}
      />
    </div>
  )
}
