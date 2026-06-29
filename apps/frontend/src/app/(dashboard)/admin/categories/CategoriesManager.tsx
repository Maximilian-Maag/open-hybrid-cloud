'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Category, CreateCategoryRequest, UpdateCategoryRequest } from '@open-hybrid-cloud/types'
import { get, post, put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { SkeletonListItem } from '@/components/ui/Skeleton'

interface Props { token: string }

export function CategoriesManager({ token }: Props) {
  const { toast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [formName, setFormName] = useState('')
  const [formOrder, setFormOrder] = useState('0')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<Category[]>('/api/admin/categories', token)
      setCategories(data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setFormName('')
    setFormOrder('0')
    setFormError(null)
    setAddOpen(true)
  }

  function openEdit(cat: Category) {
    setFormName(cat.name)
    setFormOrder(String(cat.displayOrder))
    setFormError(null)
    setEditTarget(cat)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const body: CreateCategoryRequest = { name: formName.trim(), displayOrder: Number(formOrder) }
      await post('/api/admin/categories', body, token)
      setAddOpen(false)
      toast('Category created.')
      load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    const id = editTarget.id
    setSaving(true)
    setFormError(null)
    try {
      const body: UpdateCategoryRequest = { name: formName.trim(), displayOrder: Number(formOrder) }
      await put(`/api/admin/categories/${id}`, body, token)
      setEditTarget(null)
      setFlashId(id)
      toast('Category updated.')
      load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await del(`/api/admin/categories/${deleteTarget.id}`, token)
      setDeleteTarget(null)
      toast('Category deleted.', 'info')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.')
    } finally {
      setSaving(false)
    }
  }

  const CategoryForm = ({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>
      )}
      <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} required />
      <Input label="Display Order" type="number" value={formOrder} onChange={(e) => setFormOrder(e.target.value)} />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )

  return (
    <>
      <Card
        title="Categories"
        action={<Button size="sm" onClick={openAdd}>Add Category</Button>}
      >
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonListItem key={i} />)}
          </div>
        ) : categories.length === 0 ? (
          <p className="text-center py-6 text-slate-400">No categories yet.</p>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => (
              <div key={cat.id} className={`flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3 ${cat.id === flashId ? 'animate-flash-row' : ''}`}>
                <div>
                  <span className="font-medium text-slate-900">{cat.name}</span>
                  <span className="ml-2 text-xs text-slate-400">order: {cat.displayOrder}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(cat)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(cat)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Category" size="sm">
        <CategoryForm onSubmit={handleAdd} />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Category" size="sm">
        <CategoryForm onSubmit={handleEdit} />
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Category" size="sm">
        <p className="text-sm text-slate-600 mb-6">
          Delete category <strong>{deleteTarget?.name}</strong>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>
            {saving ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
