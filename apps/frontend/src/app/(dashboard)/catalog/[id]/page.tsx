import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect, notFound } from 'next/navigation'
import type { ProductDetail, Project, CostCenter } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { OrderForm } from '@/components/forms/OrderForm'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken

  const [productRes, projectsRes, costCentersRes] = await Promise.allSettled([
    get<ProductDetail>(`/api/catalog/${id}?lang=en`, token),
    get<Project[]>('/api/projects', token),
    get<CostCenter[]>('/api/admin/cost-centers', token),
  ])

  if (productRes.status === 'rejected') notFound()
  const product = productRes.value
  const projects = projectsRes.status === 'fulfilled' ? (projectsRes.value ?? []) : []
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title={product.name} />

      <Card>
        <p className="text-slate-600 leading-relaxed">{product.description}</p>

        {product.environments.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Available Environments</h3>
            <div className="flex flex-wrap gap-2">
              {product.environments.map((env) => (
                <div
                  key={env.environmentId}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600"
                >
                  {env.environmentName ?? `Env ${env.environmentId}`} — {env.price} {env.currency}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Place Order">
        <OrderForm
          product={product}
          projects={projects}
          costCenters={costCenters}
          token={token}
        />
      </Card>
    </div>
  )
}
