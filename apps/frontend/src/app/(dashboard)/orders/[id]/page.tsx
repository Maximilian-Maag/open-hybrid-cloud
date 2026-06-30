import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import type { Order } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'

interface Props {
  params: Promise<{ id: string }>
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken

  let order: Order
  try {
    order = await get<Order>(`/api/orders/${id}`, token)
  } catch {
    notFound()
  }

  const paramEntries = Object.entries(order.parameters ?? {})

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title={`Order #${order.id}`}
        actions={
          <Link href="/orders">
            <Button variant="secondary" size="sm">Back to Orders</Button>
          </Link>
        }
      />

      <Card title="Order Details">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Product</dt>
            <dd className="text-slate-900">{order.productName ?? `#${order.productId}`}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Status</dt>
            <dd><StatusBadge status={order.status} /></dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Environment</dt>
            <dd className="text-slate-900">{order.environmentName ?? `#${order.environmentId}`}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Project</dt>
            <dd className="text-slate-900">{order.projectName ?? `#${order.projectId}`}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Ordered by</dt>
            <dd className="text-slate-900">{order.userName ?? `User #${order.userId}`}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Created</dt>
            <dd className="text-slate-900">{new Date(order.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Updated</dt>
            <dd className="text-slate-900">{new Date(order.updatedAt).toLocaleString()}</dd>
          </div>
          {order.costCenterId && (
            <div>
              <dt className="font-medium text-slate-500">Cost Center</dt>
              <dd className="text-slate-900">#{order.costCenterId}</dd>
            </div>
          )}
        </dl>

        {order.status === 'rejected' && order.rejectionNote && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm font-medium text-red-800 mb-1">Rejection Note</p>
            <p className="text-sm text-red-700">{order.rejectionNote}</p>
          </div>
        )}
      </Card>

      {paramEntries.length > 0 && (
        <Card title="Parameters">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-slate-100">
              <thead>
                <tr>
                  <th className="text-left py-2 pr-4 font-medium text-slate-500">Parameter</th>
                  <th className="text-left py-2 font-medium text-slate-500">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paramEntries.map(([key, val]) => (
                  <tr key={key}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{key}</td>
                    <td className="py-2 font-mono text-xs text-slate-900 break-all">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {order.pipelineId && order.pipelineId.length > 0 && (
        <Card title="Pipeline IDs">
          <ul className="space-y-1">
            {order.pipelineId.map((pid, i) => (
              <li key={i} className="font-mono text-xs text-slate-700 bg-slate-50 rounded px-3 py-1.5">
                {pid}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
