import { auth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import type {
  Role,
  ProductDetail,
  Category,
  DeploymentEnvironment,
  ProductTranslation,
  CostCenter,
} from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { getLang } from '@/lib/getLang'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ProductEditForm } from './ProductEditForm'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdminProductDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  const [productRes, categoriesRes, environmentsRes, translationsRes, costCentersRes] = await Promise.allSettled([
    get<ProductDetail>(`/api/admin/products/${id}`, token),
    get<Category[]>('/api/admin/categories', token),
    get<DeploymentEnvironment[]>('/api/admin/environments', token),
    get<ProductTranslation[]>(`/api/admin/products/${id}/translations`, token),
    // Needed to pick the fixed account for an `overhead` offering (FA-10.4).
    get<CostCenter[]>('/api/admin/cost-centers', token),
  ])

  if (productRes.status === 'rejected') notFound()

  const product = productRes.value
  const categories = categoriesRes.status === 'fulfilled' ? (categoriesRes.value ?? []) : []
  const environments = environmentsRes.status === 'fulfilled' ? (environmentsRes.value ?? []) : []
  const translations = translationsRes.status === 'fulfilled' ? (translationsRes.value ?? []) : []
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title={product.name}
        subtitle="Edit product details, translations, environments, and parameters."
        actions={
          <Link href="/admin/products">
            <Button variant="secondary" size="sm">Back to Products</Button>
          </Link>
        }
      />
      <ProductEditForm
        product={product}
        categories={categories}
        environments={environments}
        translations={translations}
        costCenters={costCenters}
        token={token}
        lang={lang}
      />
    </div>
  )
}
