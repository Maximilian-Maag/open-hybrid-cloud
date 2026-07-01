import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role, Category } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { NewProductForm } from './NewProductForm'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default async function NewProductPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  let categories: Category[] = []
  try {
    categories = (await get<Category[]>('/api/admin/categories', token)) ?? []
  } catch { /* empty */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="New Product"
        actions={
          <Link href="/admin/products">
            <Button variant="secondary" size="sm">Back to Products</Button>
          </Link>
        }
      />
      <NewProductForm categories={categories} token={token} />
    </div>
  )
}
