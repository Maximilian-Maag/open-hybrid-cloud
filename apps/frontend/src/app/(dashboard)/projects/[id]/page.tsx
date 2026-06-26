import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect, notFound } from 'next/navigation'
import type { Project, Order, CostCenter } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { ProjectEditForm } from './ProjectEditForm'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken

  let project: Project
  try {
    project = await get<Project>(`/api/projects/${id}`, token)
  } catch {
    notFound()
  }

  const [ordersRes, costCentersRes] = await Promise.allSettled([
    get<Order[]>(`/api/orders?projectId=${id}`, token),
    get<CostCenter[]>('/api/admin/cost-centers', token),
  ])

  const orders = ordersRes.status === 'fulfilled' ? (ordersRes.value ?? []) : []
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title={project.name}
        actions={
          <Link href="/projects">
            <Button variant="secondary" size="sm">Back to Projects</Button>
          </Link>
        }
      />

      <ProjectEditForm project={project} costCenters={costCenters} token={token} />

      {orders.length > 0 && (
        <Card title="Orders in this Project">
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
                render: (row) => row.productName ?? `#${row.productId}`,
              },
              { header: 'Environment', accessor: 'environmentName' },
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
          />
        </Card>
      )}
    </div>
  )
}
