import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect, notFound } from 'next/navigation'
import type { Project, Order, OrderPage, CostCenter } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { ProjectEditForm } from './ProjectEditForm'
import Link from 'next/link'
import { ButtonLink } from '@/components/ui/Button'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  let project: Project
  try {
    project = await get<Project>(`/api/projects/${id}`, token)
  } catch {
    notFound()
  }

  const [ordersRes, costCentersRes] = await Promise.allSettled([
    // The API honours projectId now. It used to ignore it, so this table listed
    // every order the caller could see under the heading "orders in project"
    // (#158).
    get<OrderPage>(`/api/orders?projectId=${id}`, token),
    get<CostCenter[]>('/api/admin/cost-centers', token),
  ])

  const orders: Order[] = ordersRes.status === 'fulfilled' ? (ordersRes.value?.items ?? []) : []
  const orderTotal = ordersRes.status === 'fulfilled' ? (ordersRes.value?.total ?? 0) : 0
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Breadcrumbs
        label={t('breadcrumb', lang)}
        items={[
          { label: t('projects', lang), href: '/projects' },
          { label: project.name },
        ]}
      />
      <PageHeader
        title={project.name}
        actions={
          <ButtonLink href="/projects" variant="secondary" size="sm">
            {t('backToProjects', lang)}
          </ButtonLink>
        }
      />

      <ProjectEditForm project={project} costCenters={costCenters} token={token} />

      {/* The API pages this list (#158). The heading says so when there is more
          than the first page, rather than presenting a window as the whole. */}
      {orders.length > 0 && (
        <Card
          title={
            orderTotal > orders.length
              ? `${t('ordersInProject', lang)} — ${orders.length} / ${orderTotal}`
              : t('ordersInProject', lang)
          }
        >
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
                render: (row) => row.productName ?? `#${row.productId}`,
              },
              { header: t('environment', lang), accessor: 'environmentName' },
              {
                header: t('status', lang),
                render: (row) => <StatusBadge status={row.status} lang={lang} />,
              },
              {
                header: t('date', lang),
                render: (row) => (
                  <span className="text-xs text-slate-500">
                    {new Date(row.createdAt).toLocaleDateString(lang)}
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
