import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Order, OrderPage } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TrialBadge } from '@/components/ui/TrialBadge'
import { Table } from '@/components/ui/Table'
import { Pager } from '@/components/ui/Pager'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

// The page window lives in the URL, so every page is its own render.
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function OrdersPage({ searchParams }: Props) {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  // Only `offset` is read: this list has no filters of its own, and forwarding
  // arbitrary query parameters to the API would let a bookmarked URL ask for a
  // window the page cannot render a pager for.
  const params = await searchParams
  const rawOffset = Array.isArray(params.offset) ? params.offset[0] : params.offset
  const parsedOffset = Number(rawOffset)
  const offset = Number.isInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0

  // Let a genuine fetch failure throw to the (dashboard) error boundary so an
  // outage is not mistaken for an empty list. A successful empty response
  // still renders the empty state below.
  const page = await get<OrderPage>(`/api/orders?offset=${offset}`, token)
  const orders = page?.items ?? []

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
            render: (row) => (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={row.status} lang={lang} />
                {row.isTrial && <TrialBadge lang={lang} />}
              </div>
            ),
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
        emptyMessage={t('noOrders', lang)}
      />

      <Pager
        total={page?.total ?? 0}
        limit={page?.limit ?? orders.length}
        offset={page?.offset ?? 0}
        path="/orders"
        params={new URLSearchParams()}
        lang={lang}
      />
    </div>
  )
}
