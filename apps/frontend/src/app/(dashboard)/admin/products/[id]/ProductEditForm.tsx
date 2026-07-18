'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ProductDetail,
  Category,
  DeploymentEnvironment,
  ProductTranslation,
  UpdateProductRequest,
  UpsertProductEnvironmentRequest,
  CostCenterMode,
  ProductWebhook,
  CreateProductWebhookRequest,
  PipelineStack,
  CreatePipelineStackRequest,
  StackStep,
} from '@open-hybrid-cloud/types'
import { put, post, del, get } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
]

const COST_CENTER_MODES: { value: CostCenterMode; label: string }[] = [
  { value: 'project', label: 'From Project' },
  { value: 'select', label: 'User Selection' },
  { value: 'overhead', label: 'Overhead' },
]

interface Props {
  product: ProductDetail
  categories: Category[]
  environments: DeploymentEnvironment[]
  translations: ProductTranslation[]
  token: string
}

export function ProductEditForm({ product, categories, environments, translations: initTranslations, token }: Props) {
  const router = useRouter()

  // Basic info
  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(product.description)
  const [categoryId, setCategoryId] = useState(String(product.categoryId))
  const [baseLanguage, setBaseLanguage] = useState(product.baseLanguage)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Translations
  const [translations, setTranslations] = useState<ProductTranslation[]>(initTranslations)
  const [translationLang, setTranslationLang] = useState('de')
  const [translationName, setTranslationName] = useState('')
  const [translationDesc, setTranslationDesc] = useState('')
  const [transModal, setTransModal] = useState(false)
  const [transSaving, setTransSaving] = useState(false)
  const [transError, setTransError] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)

  // Webhooks
  const [webhooks, setWebhooks] = useState<ProductWebhook[]>([])
  const [webhookModal, setWebhookModal] = useState(false)

  // Pipeline Stacks
  const [stacks, setStacks] = useState<PipelineStack[]>([])
  const [stacksLoaded, setStacksLoaded] = useState(false)
  const [stackModal, setStackModal] = useState(false)
  const [psName, setPsName] = useState('')
  const [psEnvId, setPsEnvId] = useState('')
  const [psUrl, setPsUrl] = useState('')
  const [psToken, setPsToken] = useState('')
  const [psStateKey, setPsStateKey] = useState('hostname')
  const [psSteps, setPsSteps] = useState<{ template: string; stateSuffix: string; upstreamSuffix: string; fixedParams: string }[]>([])
  const [psSaving, setPsSaving] = useState(false)
  const [psError, setPsError] = useState<string | null>(null)
  const [whEnvId, setWhEnvId] = useState('')
  const [whName, setWhName] = useState('')
  const [whUrl, setWhUrl] = useState('')
  const [whToken, setWhToken] = useState('')
  const [whOrder, setWhOrder] = useState('0')
  const [whSaving, setWhSaving] = useState(false)
  const [whError, setWhError] = useState<string | null>(null)

  async function handleSaveBasic(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const body: UpdateProductRequest = {
        name: name.trim(),
        description: description.trim(),
        categoryId: Number(categoryId),
        baseLanguage,
      }
      await put(`/api/admin/products/${product.id}`, body, token)
      setSuccess(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEnv(envId: number, data: UpsertProductEnvironmentRequest) {
    try {
      await put(`/api/admin/products/${product.id}/environments/${envId}`, data, token)
    } catch {
      /* ignored inline */
    }
  }

  async function handleAddTranslation(e: React.FormEvent) {
    e.preventDefault()
    setTransSaving(true)
    setTransError(null)
    try {
      await put(`/api/admin/products/${product.id}/translations/${translationLang}`, {
        name: translationName.trim(),
        description: translationDesc.trim(),
      }, token)
      const updated = await post<ProductTranslation[]>(`/api/admin/products/${product.id}/translations`, {}, token)
        .catch(() => null)
      if (updated) setTranslations(updated)
      else {
        const t: ProductTranslation = {
          productId: product.id,
          languageCode: translationLang,
          name: translationName.trim(),
          description: translationDesc.trim(),
        }
        setTranslations((prev) => {
          const idx = prev.findIndex((x) => x.languageCode === translationLang)
          if (idx >= 0) { const next = [...prev]; next[idx] = t; return next }
          return [...prev, t]
        })
      }
      setTransModal(false)
    } catch (e) {
      setTransError(e instanceof Error ? e.message : 'Failed to save translation.')
    } finally {
      setTransSaving(false)
    }
  }

  async function handleAiTranslate() {
    setTranslating(true)
    try {
      await post(`/api/admin/products/${product.id}/translate`, {}, token)
      router.refresh()
    } catch { /* ignore */ } finally {
      setTranslating(false)
    }
  }

  async function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault()
    setWhSaving(true)
    setWhError(null)
    try {
      const body: CreateProductWebhookRequest = {
        environmentId: Number(whEnvId),
        name: whName.trim(),
        webhookUrl: whUrl.trim(),
        webhookToken: whToken.trim(),
        execOrder: Number(whOrder),
      }
      const created = await post<ProductWebhook>(`/api/admin/products/${product.id}/webhooks`, body, token)
      setWebhooks((prev) => [...prev, created])
      setWebhookModal(false)
      setWhName(''); setWhUrl(''); setWhToken(''); setWhOrder('0')
    } catch (e) {
      setWhError(e instanceof Error ? e.message : 'Failed to create webhook.')
    } finally {
      setWhSaving(false)
    }
  }

  async function handleDeleteWebhook(whId: number) {
    try {
      await del(`/api/admin/products/${product.id}/webhooks/${whId}`, token)
      setWebhooks((prev) => prev.filter((w) => w.id !== whId))
    } catch { /* ignore */ }
  }

  async function openStackModal() {
    setPsError(null)
    setPsName(''); setPsEnvId(''); setPsUrl(''); setPsToken(''); setPsStateKey('hostname'); setPsSteps([])
    if (!stacksLoaded) {
      try {
        const loaded = await get<PipelineStack[]>(`/api/admin/products/${product.id}/pipeline-stacks`, token)
        setStacks(loaded)
        setStacksLoaded(true)
      } catch { /* ignore */ }
    }
    setStackModal(true)
  }

  function addStep() {
    setPsSteps((prev) => [...prev, { template: '', stateSuffix: '', upstreamSuffix: '', fixedParams: '' }])
  }

  function removeStep(i: number) {
    setPsSteps((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateStep(i: number, field: string, value: string) {
    setPsSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  function parseFixedParams(raw: string): Record<string, string> | undefined {
    if (!raw.trim()) return undefined
    const result: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return Object.keys(result).length ? result : undefined
  }

  async function handleAddStack(e: React.FormEvent) {
    e.preventDefault()
    setPsSaving(true)
    setPsError(null)
    try {
      const steps: StackStep[] = psSteps.map((s) => ({
        template: s.template.trim(),
        stateSuffix: s.stateSuffix.trim(),
        ...(s.upstreamSuffix.trim() ? { upstreamSuffix: s.upstreamSuffix.trim() } : {}),
        ...(parseFixedParams(s.fixedParams) ? { fixedParams: parseFixedParams(s.fixedParams) } : {}),
      }))
      const body: CreatePipelineStackRequest = {
        environmentId: Number(psEnvId),
        name: psName.trim(),
        webhookUrl: psUrl.trim(),
        webhookToken: psToken.trim(),
        stateKeyParam: psStateKey.trim() || 'hostname',
        steps,
      }
      const created = await post<PipelineStack>(`/api/admin/products/${product.id}/pipeline-stacks`, body, token)
      setStacks((prev) => [...prev, created])
      setStackModal(false)
    } catch (e) {
      setPsError(e instanceof Error ? e.message : 'Failed to create pipeline stack.')
    } finally {
      setPsSaving(false)
    }
  }

  async function handleDeleteStack(stackId: number) {
    try {
      await del(`/api/admin/products/${product.id}/pipeline-stacks/${stackId}`, token)
      setStacks((prev) => prev.filter((s) => s.id !== stackId))
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card title="Basic Information">
        <form onSubmit={handleSaveBasic} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Saved.</div>}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required
              options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <Select label="Base Language" value={baseLanguage} onChange={(e) => setBaseLanguage(e.target.value)}
              options={LANGUAGES} />
          </div>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Card>

      {/* Translations */}
      <Card title="Translations" action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleAiTranslate} disabled={translating}>
            {translating ? 'Translating…' : 'AI Translate'}
          </Button>
          <Button size="sm" onClick={() => { setTranslationName(''); setTranslationDesc(''); setTransError(null); setTransModal(true) }}>
            Add Translation
          </Button>
        </div>
      }>
        {translations.length === 0 ? (
          <p className="text-sm text-slate-400">No translations yet.</p>
        ) : (
          <div className="space-y-2">
            {translations.map((t) => (
              <div key={t.languageCode} className="rounded-lg border border-slate-100 p-3">
                <span className="text-xs font-mono text-slate-400 uppercase">{t.languageCode}</span>
                <p className="font-medium text-slate-900">{t.name}</p>
                <p className="text-sm text-slate-500 line-clamp-2">{t.description}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Environments */}
      <Card title="Environments">
        {environments.length === 0 ? (
          <p className="text-sm text-slate-400">No environments configured.</p>
        ) : (
          <div className="space-y-4">
            {environments.map((env) => {
              const existing = product.environments.find((e) => e.environmentId === env.id)
              return (
                <EnvironmentRow
                  key={env.id}
                  env={env}
                  existing={existing}
                  onSave={(data) => handleSaveEnv(env.id, data)}
                />
              )
            })}
          </div>
        )}
      </Card>

      {/* Webhooks */}
      <Card title="Webhooks" action={
        <Button size="sm" onClick={() => { setWhError(null); setWebhookModal(true) }}>Add Webhook</Button>
      }>
        {webhooks.length === 0 && product.environments.length === 0 ? (
          <p className="text-sm text-slate-400">No webhooks configured.</p>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-slate-400">No webhooks yet.</p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh) => (
              <div key={wh.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                <div>
                  <p className="font-medium text-slate-900">{wh.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{wh.webhookUrl}</p>
                </div>
                <Button size="sm" variant="danger" onClick={() => handleDeleteWebhook(wh.id)}>Delete</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pipeline Stacks */}
      <Card title="Pipeline Stacks" action={
        <Button size="sm" onClick={openStackModal}>Add Stack</Button>
      }>
        {stacks.length === 0 ? (
          <p className="text-sm text-slate-400">No pipeline stacks configured. Click &quot;Add Stack&quot; to configure one.</p>
        ) : (
          <div className="space-y-2">
            {stacks.map((s) => {
              const env = environments.find((e) => e.id === s.environmentId)
              return (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">{env?.name ?? `env #${s.environmentId}`} &middot; {s.steps.length} step{s.steps.length !== 1 ? 's' : ''} &middot; key: <span className="font-mono">{s.stateKeyParam}</span></p>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => handleDeleteStack(s.id)}>Delete</Button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Translation Modal */}
      <Modal open={transModal} onClose={() => setTransModal(false)} title="Add Translation" size="md">
        <form onSubmit={handleAddTranslation} className="space-y-4">
          {transError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{transError}</div>}
          <Select label="Language" value={translationLang} onChange={(e) => setTranslationLang(e.target.value)} options={LANGUAGES} />
          <Input label="Name" value={translationName} onChange={(e) => setTranslationName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <textarea value={translationDesc} onChange={(e) => setTranslationDesc(e.target.value)} rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setTransModal(false)}>Cancel</Button>
            <Button type="submit" disabled={transSaving}>{transSaving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>

      {/* Pipeline Stack Modal */}
      <Modal open={stackModal} onClose={() => setStackModal(false)} title="Add Pipeline Stack" size="lg">
        <form onSubmit={handleAddStack} className="space-y-4">
          {psError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{psError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" value={psName} onChange={(e) => setPsName(e.target.value)} required />
            <Select label="Environment" required value={psEnvId} onChange={(e) => setPsEnvId(e.target.value)}
              placeholder="Select environment…" options={environments.map((e) => ({ value: e.id, label: e.name }))} />
          </div>
          <Input label="Webhook URL" type="url" value={psUrl} onChange={(e) => setPsUrl(e.target.value)} required />
          <Input label="Webhook Token" value={psToken} onChange={(e) => setPsToken(e.target.value)} required />
          <Input label="State Key Parameter" value={psStateKey} onChange={(e) => setPsStateKey(e.target.value)}
            placeholder="hostname" />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Steps</label>
              <Button type="button" size="sm" variant="secondary" onClick={addStep}>+ Add Step</Button>
            </div>
            {psSteps.length === 0 && (
              <p className="text-sm text-slate-400">No steps yet. Add at least one step.</p>
            )}
            {psSteps.map((step, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Step {i + 1}</span>
                  <Button type="button" size="sm" variant="danger" onClick={() => removeStep(i)}>Remove</Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input label="Template" placeholder="linode/virtual-machine" value={step.template}
                    onChange={(e) => updateStep(i, 'template', e.target.value)} required />
                  <Input label="State Suffix" placeholder="-vm" value={step.stateSuffix}
                    onChange={(e) => updateStep(i, 'stateSuffix', e.target.value)} required />
                </div>
                <Input label="Upstream State Suffix (optional)" placeholder="-vm"
                  value={step.upstreamSuffix} onChange={(e) => updateStep(i, 'upstreamSuffix', e.target.value)} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Fixed Params (optional, one KEY=value per line)</label>
                  <textarea value={step.fixedParams} onChange={(e) => updateStep(i, 'fixedParams', e.target.value)}
                    rows={2} placeholder="LINODE_REGION=eu-central"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setStackModal(false)}>Cancel</Button>
            <Button type="submit" disabled={psSaving || psSteps.length === 0}>{psSaving ? 'Saving…' : 'Add'}</Button>
          </div>
        </form>
      </Modal>

      {/* Webhook Modal */}
      <Modal open={webhookModal} onClose={() => setWebhookModal(false)} title="Add Webhook" size="md">
        <form onSubmit={handleAddWebhook} className="space-y-4">
          {whError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{whError}</div>}
          <Select label="Environment" required value={whEnvId} onChange={(e) => setWhEnvId(e.target.value)}
            placeholder="Select environment…" options={environments.map((e) => ({ value: e.id, label: e.name }))} />
          <Input label="Name" value={whName} onChange={(e) => setWhName(e.target.value)} required />
          <Input label="Webhook URL" type="url" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} required />
          <Input label="Webhook Token" value={whToken} onChange={(e) => setWhToken(e.target.value)} />
          <Input label="Execution Order" type="number" value={whOrder} onChange={(e) => setWhOrder(e.target.value)} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setWebhookModal(false)}>Cancel</Button>
            <Button type="submit" disabled={whSaving}>{whSaving ? 'Saving…' : 'Add'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function EnvironmentRow({
  env,
  existing,
  onSave,
}: {
  env: DeploymentEnvironment
  existing?: { price: string; currency: string; costCenterMode: CostCenterMode; forcedCostCenter: boolean }
  onSave: (data: UpsertProductEnvironmentRequest) => Promise<void>
}) {
  const [price, setPrice] = useState(existing?.price ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? 'EUR')
  const [costCenterMode, setCostCenterMode] = useState<CostCenterMode>(existing?.costCenterMode ?? 'project')
  const [forcedCostCenter, setForcedCostCenter] = useState(existing?.forcedCostCenter ?? false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave({ price, currency, costCenterMode, forcedCostCenter })
    setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form onSubmit={handleSave} className="rounded-lg border border-slate-200 p-4 space-y-3">
      <h4 className="font-medium text-slate-900">{env.name}</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Input label="Price" value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="0.00" />
        <Input label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} required placeholder="EUR" />
        <Select label="Cost Center Mode" value={costCenterMode}
          onChange={(e) => setCostCenterMode(e.target.value as CostCenterMode)} options={COST_CENTER_MODES} />
        <div className="flex flex-col gap-1 justify-end">
          <label className="text-sm font-medium text-slate-700">Forced CC</label>
          <div className="flex items-center h-9">
            <input type="checkbox" checked={forcedCostCenter} onChange={(e) => setForcedCostCenter(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        {saved && <span className="text-xs text-green-600">Saved!</span>}
      </div>
    </form>
  )
}
