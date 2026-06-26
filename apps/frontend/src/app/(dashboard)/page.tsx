import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Order, InfrastructureElement, Project, Product, Role } from '@open-hybrid-cloud/types'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = (
    <div className="flex flex-col gap-1">
      <span className="text-3xl font-bold text-slate-900">{value}</span>
      <span className="text-sm text-slate-500">{label}</span>
    </div>
  )
  if (href) {
    return (
      <Link href={href} className="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300 transition-colors">
        {content}
      </Link>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {content}
    </div>
  )
}

export default async function DashboardHome() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const role = (session.user as unknown as { role: Role }).role

  const [orders, infra, projects, products] = await Promise.allSettled([
    get<Order[]>('/api/orders', token),
    get<InfrastructureElement[]>('/api/infrastructure', token),
    get<Project[]>('/api/projects', token),
    get<Product[]>('/api/catalog?lang=en', token),
  ])

  const orderList = orders.status === 'fulfilled' ? (orders.value ?? []) : []
  const infraList = infra.status === 'fulfilled' ? (infra.value ?? []) : []
  const projectList = projects.status === 'fulfilled' ? (projects.value ?? []) : []
  const productList = products.status === 'fulfilled' ? (products.value ?? []) : []

  const activeInfra = infraList.filter((i) => i.status === 'active').length
  const pendingApprovals = orderList.filter((o) => o.status === 'pending').length
  const featuredProducts = productList.slice(0, 6)

  const isAdminOrRoot = role === 'admin' || role === 'root'

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <PageHeader
        title={`Welcome back, ${session.user?.name ?? 'User'}`}
        subtitle="Here's what's happening with your infrastructure."
      />

      <div className={`grid gap-4 ${isAdminOrRoot ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3'}`}>
        <StatCard label="Total Orders" value={orderList.length} href="/orders" />
        <StatCard label="Active Infrastructure" value={activeInfra} href="/infrastructure" />
        {isAdminOrRoot && (
          <StatCard label="Pending Approvals" value={pendingApprovals} href="/approvals" />
        )}
        <StatCard label="Projects" value={projectList.length} href="/projects" />
      </div>

      {featuredProducts.length > 0 && (
        <Card title="Featured Products" action={
          <Link href="/catalog" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all
          </Link>
        }>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featuredProducts.map((product) => (
              <Link
                key={product.id}
                href={`/catalog/${product.id}`}
                className="group flex flex-col gap-2 rounded-lg border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <h4 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                  {product.name}
                </h4>
                <p className="text-xs text-slate-500 line-clamp-2 flex-1">{product.description}</p>
                <span className="text-xs font-medium text-blue-600">Order now →</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {orderList.length > 0 && (
        <Card title="Recent Orders" action={
          <Link href="/orders" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all
          </Link>
        }>
          <div className="space-y-2">
            {orderList.slice(0, 5).map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="flex items-center justify-between rounded-lg p-3 hover:bg-slate-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {order.productName ?? `Product #${order.productId}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {order.environmentName} · {order.projectName} · {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
