'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CostCenter, CreateCostCenterRequest, UpdateCostCenterRequest } from '@open-hybrid-cloud/types'
import { get, post, put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface Props { token: string }

export function CostCentersManager({ token }: Props) {
  const [ccs, setCcs] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CostCenter | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CostCenter | null>(null)
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCcs((await get<CostCenter[]>('/api/admin/cost-centers', token)) ?? [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setFormCode(''); setFormName(''); setFormActive(true); setFormError(null); setAddOpen(true)
  }

  function openEdit(cc: CostCenter) {
    setFormCode(cc.code); setFormName(cc.name); setFormActive(cc.active); setFormError(null); setEditTarget(cc)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setFormError(null)
    try {
      const body: CreateCostCenterRequest = { code: formCode.trim(), name: formName.trim(), active: formActive }
      await post('/api/admin/cost-centers', body, token)
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
      const body: UpdateCostCenterRequest = { code: formCode.trim(), name: formName.trim(), active: formActive }
      await put(`/api/admin/cost-centers/${editTarget.id}`, body, token)
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
      await del(`/api/admin/cost-centers/${deleteTarget.id}`, token)
      setDeleteTarget(null); load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(cc: CostCenter) {
    try {
      await put(`/api/admin/cost-centers/${cc.id}`, { active: !cc.active }, token)
      load()
    } catch { /* ignore */ }
  }

  const CcForm = ({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
      <Input label="Code" value={formCode} onChange={(e) => setFormCode(e.target.value)} required placeholder="e.g. CC-100" />
      <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} required />
      <div className="flex items-center gap-2">
        <input type="checkbox" id="active" checked={formActive} onChange={(e) => setFormActive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
        <label htmlFor="active" className="text-sm font-medium text-slate-700">Active</label>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )

  return (
    <>
      <Card title="Cost Centers" action={<Button size="sm" onClick={openAdd}>Add Cost Center</Button>}>
        {loading ? (
          <div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" /></div>
        ) : ccs.length === 0 ? (
          <p className="text-center py-6 text-slate-400">No cost centers yet.</p>
        ) : (
          <div className="space-y-2">
            {ccs.map((cc) => (
              <div key={cc.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2 w-2 rounded-full ${cc.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                  <div>
                    <span className="font-mono text-sm font-medium text-slate-700">{cc.code}</span>
                    <span className="ml-2 text-slate-900">{cc.name}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(cc)}>
                    {cc.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(cc)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(cc)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Cost Center" size="sm">
        <CcForm onSubmit={handleAdd} />
      </Modal>
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Cost Center" size="sm">
        <CcForm onSubmit={handleEdit} />
      </Modal>
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Cost Center" size="sm">
        <p className="text-sm text-slate-600 mb-6">Delete cost center <strong>{deleteTarget?.code}</strong> — {deleteTarget?.name}?</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Modal>
    </>
  )
}
