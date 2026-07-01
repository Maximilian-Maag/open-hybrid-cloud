'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Category, CreateProductRequest, Product } from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
]

interface Props {
  categories: Category[]
  token: string
}

export function NewProductForm({ categories, token }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [baseLanguage, setBaseLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoryId) { setError('Select a category.'); return }
    setSaving(true)
    setError(null)
    try {
      const body: CreateProductRequest = {
        name: name.trim(),
        description: description.trim(),
        categoryId: Number(categoryId),
        baseLanguage,
      }
      const created = await post<Product>('/api/admin/products', body, token)
      router.push(`/admin/products/${created.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Product Details">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <Select
          label="Category"
          required
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          placeholder="Select category…"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label="Base Language"
          value={baseLanguage}
          onChange={(e) => setBaseLanguage(e.target.value)}
          options={LANGUAGES}
        />
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Product'}</Button>
        </div>
      </form>
    </Card>
  )
}
