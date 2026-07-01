'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CiSource, CiProvider, CreateCiSourceRequest, UpdateCiSourceRequest } from '@open-hybrid-cloud/types'
import { get, post, put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

const PROVIDERS: { value: CiProvider; label: string }[] = [
  { value: 'gitlab', label: 'GitLab' },
  { value: 'github', label: 'GitHub' },
  { value: 'bitbucket', label: 'Bitbucket' },
]

interface Props { token: string }

const emptyForm = () => ({ name: '', url: '', accessToken: '', provider: 'gitlab' as CiProvider })

export function CiSourcesManager({ token }: Props) {
  const [sources, setSources] = useState<CiSource[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CiSource | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CiSource | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSources((await get<CiSource[]>('/api/admin/ci-sources', token)) ?? [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  function setField(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setForm(emptyForm())
    setFormError(null)
    setAddOpen(true)
  }

  function openEdit(src: CiSource) {
    setForm({ name: src.name, url: src.url, accessToken: '', provider: src.provider })
    setFormError(null)
    setEditTarget(src)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const body: CreateCiSourceRequest = {
        name: form.name.trim(),
        url: form.url.trim(),
        accessToken: form.accessToken.trim(),
        provider: form.provider,
      }
      await post('/api/admin/ci-sources', body, token)
      setAddOpen(false)
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
    setSaving(true)
    setFormError(null)
    try {
      const body: UpdateCiSourceRequest = {
        name: form.name.trim(),
        url: form.url.trim(),
        provider: form.provider,
        ...(form.accessToken ? { accessToken: form.accessToken.trim() } : {}),
      }
      await put(`/api/admin/ci-sources/${editTarget.id}`, body, token)
      setEditTarget(null)
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
      await del(`/api/admin/ci-sources/${deleteTarget.id}`, token)
      setDeleteTarget(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  const CiForm = ({ onSubmit, isEdit }: { onSubmit: (e: React.FormEvent) => void; isEdit?: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
      <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
      <Input label="URL" type="url" value={form.url} onChange={(e) => setField('url', e.target.value)} required />
      <Select label="Provider" value={form.provider} onChange={(e) => setField('provider', e.target.value)} options={PROVIDERS} />
      <Input label={isEdit ? 'Access Token (leave blank to keep)' : 'Access Token'} type="password"
        value={form.accessToken} onChange={(e) => setField('accessToken', e.target.value)} required={!isEdit} />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )

  const providerBadge: Record<CiProvider, string> = {
    gitlab: 'bg-orange-100 text-orange-700',
    github: 'bg-slate-100 text-slate-700',
    bitbucket: 'bg-blue-100 text-blue-700',
  }

  return (
    <>
      <Card title="CI Sources" action={<Button size="sm" onClick={openAdd}>Add CI Source</Button>}>
        {loading ? (
          <div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" /></div>
        ) : sources.length === 0 ? (
          <p className="text-center py-6 text-slate-400">No CI sources yet.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((src) => (
              <div key={src.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-slate-900">{src.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${providerBadge[src.provider]}`}>
                      {src.provider}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">{src.url}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(src)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(src)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add CI Source" size="md">
        <CiForm onSubmit={handleAdd} />
      </Modal>
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit CI Source" size="md">
        <CiForm onSubmit={handleEdit} isEdit />
      </Modal>
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete CI Source" size="sm">
        <p className="text-sm text-slate-600 mb-6">Delete <strong>{deleteTarget?.name}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Modal>
    </>
  )
}
