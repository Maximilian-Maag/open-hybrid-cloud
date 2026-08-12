'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  DeploymentEnvironment,
  CiSource,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
  CallbackSecretResponse,
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

  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [callbackSecret, setCallbackSecret] = useState<string | null>(null)
  const [secretBusy, setSecretBusy] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function revealCallbackSecret() {
    if (!editTarget) return
    setSecretBusy(true)
    setSecretError(null)
    try {
      const res = await get<CallbackSecretResponse>(`/api/admin/environments/${editTarget.id}/callback-secret`, token)
      setCallbackSecret(res?.callbackSecret ?? null)
    } catch (e) {
      setCallbackSecret(null)
      setSecretError(e instanceof Error ? e.message : 'Failed to load callback secret.')
    } finally {
      setSecretBusy(false)
    }
  }

  async function doRegenerateCallbackSecret() {
    if (!editTarget) return
    setRegenConfirmOpen(false)
    setSecretBusy(true)
    setSecretError(null)
    try {
      const res = await post<CallbackSecretResponse>(`/api/admin/environments/${editTarget.id}/callback-secret`, {}, token)
      setCallbackSecret(res?.callbackSecret ?? null)
    } catch (e) {
      setSecretError(e instanceof Error ? e.message : 'Failed to regenerate callback secret.')
    } finally {
      setSecretBusy(false)
    }
  }

  async function copyCallbackSecret() {
    if (!callbackSecret) return
    try {
      await navigator.clipboard.writeText(callbackSecret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setSecretError(e instanceof Error ? e.message : 'Failed to copy to clipboard.')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    setDeleteError(null)
    try {
      await del(`/api/admin/environments/${deleteTarget.id}`, token)
      setDeleteTarget(null)
      load()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete environment.')
    } finally {
      setSaving(false)
    }
  }

  const ciOptions = ciSources.map((c) => ({ value: c.id, label: c.name }))

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
        <form onSubmit={handleAdd} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
          <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          <Input label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} />
          <Select label="CI Source" required value={form.ciSourceId} onChange={(e) => setField('ciSourceId', e.target.value)}
            placeholder="Select CI source…" options={ciOptions} />
          <Input label="Webhook URL" type="url" value={form.webhookUrl} onChange={(e) => setField('webhookUrl', e.target.value)} required />
          <Input label="Webhook Token" value={form.webhookToken} onChange={(e) => setField('webhookToken', e.target.value)} required />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null) }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!editTarget} onClose={() => { setEditTarget(null); setCallbackSecret(null); setSecretError(null); setCopied(false) }} title="Edit Environment" size="md">
        <form onSubmit={handleEdit} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{formError}</div>}
          <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          <Input label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} />
          <Select label="CI Source" required value={form.ciSourceId} onChange={(e) => setField('ciSourceId', e.target.value)}
            placeholder="Select CI source…" options={ciOptions} />
          <Input label="Webhook URL (leave blank to keep)" type="url" value={form.webhookUrl} onChange={(e) => setField('webhookUrl', e.target.value)} />
          <Input label="Webhook Token — outbound trigger (leave blank to keep)" value={form.webhookToken} onChange={(e) => setField('webhookToken', e.target.value)} hint="This is the token GitLab expects on the pipeline-trigger POST (Settings → CI/CD → Pipeline trigger tokens)." />
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Callback Secret — inbound pipeline events</p>
                <p className="text-xs text-slate-500">Portal-generated. Paste this into GitLab → Settings → Webhooks → Secret token so pipeline-event callbacks are accepted.</p>
              </div>
            </div>
            {secretError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{secretError}</div>
            )}
            {callbackSecret ? (
              <div className="flex items-center gap-2">
                <input readOnly value={callbackSecret} className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs font-mono text-slate-700 bg-slate-50" />
                <Button type="button" size="sm" variant="secondary" onClick={copyCallbackSecret}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={revealCallbackSecret} disabled={secretBusy}>
                {secretBusy ? 'Loading…' : 'Reveal current'}
              </Button>
            )}
            <div>
              <Button type="button" size="sm" variant="danger" onClick={() => setRegenConfirmOpen(true)} disabled={secretBusy}>
                {secretBusy ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null); setCallbackSecret(null); setSecretError(null); setCopied(false) }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteError(null) }} title="Delete Environment" size="sm">
        <p className="text-sm text-slate-600 mb-4">Delete <strong>{deleteTarget?.name}</strong>?</p>
        {deleteError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{deleteError}</div>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteError(null) }}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Modal>
      <Modal open={regenConfirmOpen} onClose={() => setRegenConfirmOpen(false)} title="Regenerate Callback Secret" size="sm">
        <p className="text-sm text-slate-600 mb-4">
          Regenerate the callback secret? You will need to paste the new value into GitLab → Settings → Webhooks for
          pipeline events to keep updating this portal.
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setRegenConfirmOpen(false)}>Cancel</Button>
          <Button type="button" variant="danger" onClick={doRegenerateCallbackSecret} disabled={secretBusy}>
            {secretBusy ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
