import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Order } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'

export default async function OrdersPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken

  let orders: Order[] = []
  try {
    orders = (await get<Order[]>('/api/orders', token)) ?? []
  } catch {
    /* empty */
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title="Orders" subtitle="View and manage your infrastructure orders." />

      <Table<Order>
        columns={[
          {
            header: 'ID',
            render: (row) => (
              <Link href={`/orders/${row.id}`} className="font-mono text-blue-600 hover:underline text-xs">
                #{row.id}
              </Link>
            ),
          },
          {
            header: 'Product',
            render: (row) => (
              <span className="font-medium text-slate-900">
                {row.productName ?? `Product #${row.productId}`}
              </span>
            ),
          },
          { header: 'Environment', accessor: 'environmentName' },
          { header: 'Project', accessor: 'projectName' },
          {
            header: 'Status',
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            header: 'Date',
            render: (row) => (
              <span className="text-xs text-slate-500">
                {new Date(row.createdAt).toLocaleDateString()}
              </span>
            ),
          },
        ]}
        data={orders}
        emptyMessage="No orders yet."
      />
    </div>
  )
}
