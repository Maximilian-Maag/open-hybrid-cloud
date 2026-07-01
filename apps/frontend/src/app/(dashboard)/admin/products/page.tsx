import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Role, Product, Category } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { Table } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'

export default async function AdminProductsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  const [productsRes, categoriesRes] = await Promise.allSettled([
    get<Product[]>('/api/admin/products', token),
    get<Category[]>('/api/admin/categories', token),
  ])

  const products = productsRes.status === 'fulfilled' ? (productsRes.value ?? []) : []
  const categories = categoriesRes.status === 'fulfilled' ? (categoriesRes.value ?? []) : []

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Products"
        subtitle="Manage catalog products."
        actions={
          <Link href="/admin/products/new">
            <Button>New Product</Button>
          </Link>
        }
      />

      <Table<Product>
        columns={[
          {
            header: 'Name',
            render: (row) => (
              <Link href={`/admin/products/${row.id}`} className="font-medium text-blue-600 hover:underline">
                {row.name}
              </Link>
            ),
          },
          {
            header: 'Category',
            render: (row) => catMap[row.categoryId] ?? `#${row.categoryId}`,
          },
          { header: 'Language', accessor: 'baseLanguage' },
          {
            header: 'Created',
            render: (row) => (
              <span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleDateString()}</span>
            ),
          },
          {
            header: '',
            render: (row) => (
              <Link href={`/admin/products/${row.id}`}>
                <Button size="sm" variant="secondary">Edit</Button>
              </Link>
            ),
          },
        ]}
        data={products}
        emptyMessage="No products yet."
      />
    </div>
  )
}
