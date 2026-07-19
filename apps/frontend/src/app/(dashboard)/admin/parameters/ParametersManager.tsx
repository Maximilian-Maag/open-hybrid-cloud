'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Parameter, ParameterType, CreateParameterRequest, UpdateParameterRequest } from '@open-hybrid-cloud/types'
import { get, post, put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface Props { token: string }

const TYPES: { value: ParameterType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'bool', label: 'Boolean' },
  { value: 'dropdown', label: 'Dropdown' },
]

const emptyForm = () => ({
  name: '', type: 'string' as ParameterType, description: '',
  defaultValue: '', required: false, sensitive: false,
})

export function ParametersManager({ token }: Props) {
  const [params, setParams] = useState<Parameter[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Parameter | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Parameter | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = (await get<Parameter[]>('/api/admin/parameters', token)) ?? []
      setParams(all.filter((p) => p.scope === 'global'))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  function setField<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setForm(emptyForm()); setFormError(null); setAddOpen(true)
  }

  function openEdit(param: Parameter) {
    setForm({
      name: param.name, type: param.type, description: param.description,
      defaultValue: param.defaultValue, required: param.required, sensitive: param.sensitive,
    })
    setFormError(null); setEditTarget(param)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setFormError(null)
    try {
      const body: CreateParameterRequest = {
        scope: 'global', scopeId: 0,
        name: form.name.trim(), type: form.type,
        description: form.description.trim() || undefined,
        defaultValue: form.defaultValue.trim() || undefined,
        required: form.required, sensitive: form.sensitive,
      }
      await post('/api/admin/parameters', body, token)
      setAddOpen(false); load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setSaving(true); setFormError(null)
    try {
      const body: UpdateParameterRequest = {
        name: form.name.trim(), type: form.type,
        description: form.description.trim() || undefined,
        defaultValue: form.defaultValue.trim() || undefined,
        required: form.required, sensitive: form.sensitive,
      }
      await put(`/api/admin/parameters/${editTarget.id}`, body, token)
      setEditTarget(null); load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await del(`/api/admin/parameters/${deleteTarget.id}`, token)
      setDeleteTarget(null); load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card title="Global Parameters" action={<Button size="sm" onClick={openAdd}>Add Parameter</Button>}>
        {loading ? (
          <div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" /></div>
        ) : params.length === 0 ? (
          <p className="text-center py-6 text-slate-400">No global parameters yet.</p>
        ) : (
          <div className="space-y-2">
            {params.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-slate-900">{p.name}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.type}</span>
                    {p.required && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">required</span>}
                    {p.sensitive && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">sensitive</span>}
                  </div>
                  {p.description && <p className="text-xs text-slate-500">{p.description}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(p)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Parameter" size="md">
        <form onSubmit={handleAdd} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
          <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          <Select label="Type" value={form.type} onChange={(e) => setField('type', e.target.value as ParameterType)} options={TYPES} />
          <Input label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} />
          <Input label="Default Value" value={form.defaultValue} onChange={(e) => setField('defaultValue', e.target.value)}
            hint={form.type === 'dropdown' ? 'Comma-separated options' : undefined} />
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="add-required" checked={form.required} onChange={(e) => setField('required', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="add-required" className="text-sm font-medium text-slate-700">Required</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="add-sensitive" checked={form.sensitive} onChange={(e) => setField('sensitive', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="add-sensitive" className="text-sm font-medium text-slate-700">Sensitive</label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Parameter" size="md">
        <form onSubmit={handleEdit} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
          <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          <Select label="Type" value={form.type} onChange={(e) => setField('type', e.target.value as ParameterType)} options={TYPES} />
          <Input label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} />
          <Input label="Default Value" value={form.defaultValue} onChange={(e) => setField('defaultValue', e.target.value)}
            hint={form.type === 'dropdown' ? 'Comma-separated options' : undefined} />
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="edit-required" checked={form.required} onChange={(e) => setField('required', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="edit-required" className="text-sm font-medium text-slate-700">Required</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="edit-sensitive" checked={form.sensitive} onChange={(e) => setField('sensitive', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="edit-sensitive" className="text-sm font-medium text-slate-700">Sensitive</label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Parameter" size="sm">
        <p className="text-sm text-slate-600 mb-6">Delete parameter <strong>{deleteTarget?.name}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Modal>
    </>
  )
}
