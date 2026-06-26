'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  DeploymentEnvironment,
  CiSource,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
} from '@open-hybrid-cloud/types'
import { get, post, put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface Props {
  token: string
  ciSources: CiSource[]
}

const emptyForm = () => ({
  name: '', description: '', ciSourceId: '', webhookUrl: '', webhookToken: '',
})

export function EnvironmentsManager({ token, ciSources }: Props) {
  const [envs, setEnvs] = useState<DeploymentEnvironment[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<DeploymentEnvironment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeploymentEnvironment | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEnvs((await get<DeploymentEnvironment[]>('/api/admin/environments', token)) ?? [])
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

  function openEdit(env: DeploymentEnvironment) {
    setForm({
      name: env.name,
      description: env.description ?? '',
      ciSourceId: String(env.ciSourceId),
      webhookUrl: '',
      webhookToken: '',
    })
    setFormError(null)
    setEditTarget(env)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const body: CreateEnvironmentRequest = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        ciSourceId: Number(form.ciSourceId),
        webhookUrl: form.webhookUrl.trim(),
        webhookToken: form.webhookToken.trim(),
      }
      await post('/api/admin/environments', body, token)
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
      const body: UpdateEnvironmentRequest = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        ciSourceId: Number(form.ciSourceId),
        ...(form.webhookUrl ? { webhookUrl: form.webhookUrl.trim() } : {}),
        ...(form.webhookToken ? { webhookToken: form.webhookToken.trim() } : {}),
      }
      await put(`/api/admin/environments/${editTarget.id}`, body, token)
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
      await del(`/api/admin/environments/${deleteTarget.id}`, token)
      setDeleteTarget(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  const ciOptions = ciSources.map((c) => ({ value: c.id, label: c.name }))

  const EnvForm = ({ onSubmit, isEdit }: { onSubmit: (e: React.FormEvent) => void; isEdit?: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
      <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
      <Input label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} />
      <Select label="CI Source" required value={form.ciSourceId} onChange={(e) => setField('ciSourceId', e.target.value)}
        placeholder="Select CI source…" options={ciOptions} />
      <Input label="Webhook URL" type="url" value={form.webhookUrl} onChange={(e) => setField('webhookUrl', e.target.value)}
        required={!isEdit} />
      <Input label="Webhook Token" value={form.webhookToken} onChange={(e) => setField('webhookToken', e.target.value)}
        required={!isEdit} />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )

  return (
    <>
      <Card title="Environments" action={<Button size="sm" onClick={openAdd}>Add Environment</Button>}>
        {loading ? (
          <div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" /></div>
        ) : envs.length === 0 ? (
          <p className="text-center py-6 text-slate-400">No environments yet.</p>
        ) : (
          <div className="space-y-2">
            {envs.map((env) => (
              <div key={env.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{env.name}</p>
                  {env.description && <p className="text-xs text-slate-500">{env.description}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(env)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(env)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Environment" size="md">
        <EnvForm onSubmit={handleAdd} />
      </Modal>
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Environment" size="md">
        <EnvForm onSubmit={handleEdit} isEdit />
      </Modal>
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Environment" size="sm">
        <p className="text-sm text-slate-600 mb-6">Delete <strong>{deleteTarget?.name}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Modal>
    </>
  )
}
