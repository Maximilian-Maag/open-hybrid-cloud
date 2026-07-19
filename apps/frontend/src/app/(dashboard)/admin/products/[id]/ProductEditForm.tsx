'use client'

import { useState, useEffect } from 'react'
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
  UpdatePipelineStackRequest,
  StackStep,
  Parameter,
  ParameterType,
  CreateParameterRequest,
  UpdateParameterRequest,
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
  const [stackModal, setStackModal] = useState(false)
  const [editStack, setEditStack] = useState<PipelineStack | null>(null)
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

  // Parameters
  const [productParams, setProductParams] = useState<Parameter[]>(product.parameters ?? [])
  const [paramModal, setParamModal] = useState(false)
  const [paramSyncing, setParamSyncing] = useState(false)
  const [paramSyncMsg, setParamSyncMsg] = useState<string | null>(null)
  const [paramError, setParamError] = useState<string | null>(null)
  const [paramSaving, setParamSaving] = useState(false)
  const [editParam, setEditParam] = useState<Parameter | null>(null)
  const [paramForm, setParamForm] = useState({
    name: '', label: '', type: 'string' as ParameterType, description: '', defaultValue: '', required: false, sensitive: false,
  })

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

  useEffect(() => {
    get<PipelineStack[]>(`/api/admin/products/${product.id}/pipeline-stacks`, token)
      .then(setStacks)
      .catch(() => {})
  }, [product.id, token])

  function openStackModal() {
    setPsError(null)
    setEditStack(null)
    setPsName(''); setPsEnvId(''); setPsUrl(''); setPsToken(''); setPsStateKey('hostname'); setPsSteps([])
    setStackModal(true)
  }

  function openEditStackModal(stack: PipelineStack) {
    setPsError(null)
    setEditStack(stack)
    setPsName(stack.name)
    setPsEnvId(String(stack.environmentId))
    setPsUrl(stack.webhookUrl)
    setPsToken('')
    setPsStateKey(stack.stateKeyParam)
    setPsSteps(stack.steps.map((s) => ({
      template: s.template,
      stateSuffix: s.stateSuffix,
      upstreamSuffix: s.upstreamSuffix ?? '',
      fixedParams: s.fixedParams ? Object.entries(s.fixedParams).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    })))
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

  async function handleSaveStack(e: React.FormEvent) {
    e.preventDefault()
    setPsSaving(true)
    setPsError(null)
    try {
      const steps: StackStep[] = psSteps.map((s) => {
        const fixedParams = parseFixedParams(s.fixedParams)
        return {
          template: s.template.trim(),
          stateSuffix: s.stateSuffix.trim(),
          ...(s.upstreamSuffix.trim() ? { upstreamSuffix: s.upstreamSuffix.trim() } : {}),
          ...(fixedParams ? { fixedParams } : {}),
        }
      })
      if (editStack) {
        const body: UpdatePipelineStackRequest = {
          name: psName.trim(),
          webhookUrl: psUrl.trim(),
          stateKeyParam: psStateKey.trim() || 'hostname',
          steps,
          ...(psToken.trim() ? { webhookToken: psToken.trim() } : {}),
        }
        const updated = await put<PipelineStack>(`/api/admin/products/${product.id}/pipeline-stacks/${editStack.id}`, body, token)
        setStacks((prev) => prev.map((s) => s.id === editStack.id ? updated : s))
      } else {
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
      }
      setStackModal(false)
    } catch (e) {
      setPsError(e instanceof Error ? e.message : 'Failed to save pipeline stack.')
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

  async function handleSyncParams() {
    setParamSyncing(true)
    setParamSyncMsg(null)
    setParamError(null)
    try {
      const result = await post<{ created: number; skipped: number }>(
        `/api/admin/products/${product.id}/sync-parameters`, {}, token,
      )
      const refreshed = await get<Parameter[]>(
        `/api/admin/parameters?scope=product&scopeId=${product.id}`, token,
      )
      if (refreshed) setProductParams(refreshed)
      setParamSyncMsg(
        `Imported ${result.created} parameter${result.created !== 1 ? 's' : ''}` +
        (result.skipped ? `, ${result.skipped} already existed.` : '.'),
      )
    } catch (e) {
      setParamError(e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setParamSyncing(false)
    }
  }

  function openAddParamModal() {
    setEditParam(null)
    setParamError(null)
    setParamSyncMsg(null)
    setParamForm({ name: '', label: '', type: 'string', description: '', defaultValue: '', required: false, sensitive: false })
    setParamModal(true)
  }

  function openEditParamModal(p: Parameter) {
    setEditParam(p)
    setParamError(null)
    setParamSyncMsg(null)
    setParamForm({ name: p.name, label: p.label, type: p.type, description: p.description, defaultValue: p.defaultValue, required: p.required, sensitive: p.sensitive })
    setParamModal(true)
  }

  async function handleSaveParam(e: React.FormEvent) {
    e.preventDefault()
    setParamSaving(true)
    setParamError(null)
    try {
      if (editParam) {
        const body: UpdateParameterRequest = {
          name: paramForm.name.trim(),
          label: paramForm.label.trim(),
          type: paramForm.type,
          description: paramForm.description.trim() || undefined,
          defaultValue: paramForm.defaultValue.trim() || undefined,
          required: paramForm.required,
          sensitive: paramForm.sensitive,
        }
        const updated = await put<Parameter>(`/api/admin/parameters/${editParam.id}`, body, token)
        setProductParams((prev) => prev.map((p) => p.id === editParam.id ? updated : p))
      } else {
        const body: CreateParameterRequest = {
          scope: 'product',
          scopeId: product.id,
          name: paramForm.name.trim(),
          label: paramForm.label.trim(),
          type: paramForm.type,
          description: paramForm.description.trim() || undefined,
          defaultValue: paramForm.defaultValue.trim() || undefined,
          required: paramForm.required,
          sensitive: paramForm.sensitive,
        }
        const created = await post<Parameter>('/api/admin/parameters', body, token)
        setProductParams((prev) => [...prev, created])
      }
      setParamModal(false)
    } catch (e) {
      setParamError(e instanceof Error ? e.message : 'Failed to save parameter.')
    } finally {
      setParamSaving(false)
    }
  }

  async function handleDeleteParam(paramId: number) {
    try {
      await del(`/api/admin/parameters/${paramId}`, token)
      setProductParams((prev) => prev.filter((p) => p.id !== paramId))
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

      {/* Parameters */}
      <Card title="Parameters" action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleSyncParams}
            disabled={paramSyncing || stacks.length === 0}
            title={stacks.length === 0 ? 'Add a pipeline stack first' : 'Import from template variables.tf'}>
            {paramSyncing ? 'Syncing…' : 'Sync from template'}
          </Button>
          <Button size="sm" onClick={openAddParamModal}>Add Parameter</Button>
        </div>
      }>
        {paramSyncMsg && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{paramSyncMsg}</div>}
        {paramError && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{paramError}</div>}
        {productParams.length === 0 ? (
          <p className="text-sm text-slate-400">No parameters yet. Use &quot;Sync from template&quot; to import from the template&apos;s variables.tf, or add manually.</p>
        ) : (
          <div className="space-y-2">
            {productParams.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-slate-900">{p.label || p.name}</p>
                    <span className="font-mono text-xs text-slate-400">{p.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.type}</span>
                    {p.required && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">required</span>}
                    {p.sensitive && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">sensitive</span>}
                  </div>
                  {p.description && <p className="text-xs text-slate-500">{p.description}</p>}
                  {p.defaultValue && <p className="text-xs text-slate-400 font-mono">default: {p.defaultValue}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEditParamModal(p)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDeleteParam(p.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Order Callbacks */}
      <Card title="Order Callbacks" action={
        <Button size="sm" onClick={() => { setWhError(null); setWebhookModal(true) }}>Add Webhook</Button>
      }>
        <p className="text-xs text-slate-500 mb-3">Optional HTTP callbacks the platform calls after an order is processed — use these to notify external systems such as ticketing or monitoring tools. Pipeline Stacks handle the actual provisioning.</p>
        {webhooks.length === 0 ? (
          <p className="text-sm text-slate-400">No callbacks configured.</p>
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
                <div key={s.id} data-testid="stack-item" className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">{env?.name ?? `env #${s.environmentId}`} &middot; {s.steps.length} step{s.steps.length !== 1 ? 's' : ''} &middot; key: <span className="font-mono">{s.stateKeyParam}</span></p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEditStackModal(s)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteStack(s.id)}>Delete</Button>
                  </div>
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
      <Modal open={stackModal} onClose={() => setStackModal(false)} title={editStack ? 'Edit Pipeline Stack' : 'Add Pipeline Stack'} size="lg">
        <form onSubmit={handleSaveStack} className="space-y-4">
          {psError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{psError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" value={psName} onChange={(e) => setPsName(e.target.value)} required />
            <Select label="Environment" required={!editStack} value={psEnvId} onChange={(e) => setPsEnvId(e.target.value)}
              placeholder="Select environment…" options={environments.map((e) => ({ value: e.id, label: e.name }))}
              disabled={!!editStack} />
          </div>
          <Input label="Webhook URL" type="url" value={psUrl} onChange={(e) => setPsUrl(e.target.value)} required />
          <Input label="Webhook Token" value={psToken} onChange={(e) => setPsToken(e.target.value)}
            required={!editStack} hint={editStack ? 'Leave blank to keep existing token' : undefined} />
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
                    onChange={(e) => updateStep(i, 'template', e.target.value)} required
                    hint="Path under templates/ in your infra-templates repo" />
                  <Input label="State Suffix" placeholder="-vm" value={step.stateSuffix}
                    onChange={(e) => updateStep(i, 'stateSuffix', e.target.value)} required
                    hint="Appended to the state key param to form the Terraform state name (e.g. hostname + -vm)" />
                </div>
                <Input label="Upstream State Suffix (optional)" placeholder="-vm"
                  value={step.upstreamSuffix} onChange={(e) => updateStep(i, 'upstreamSuffix', e.target.value)}
                  hint="Read Terraform outputs (e.g. ip_address, id) from the step with this suffix as inputs to this step" />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Fixed Parameters (optional)</label>
                  <p className="text-xs text-slate-500">Override or hardcode order parameters for this step only — one KEY=value per line</p>
                  <textarea value={step.fixedParams} onChange={(e) => updateStep(i, 'fixedParams', e.target.value)}
                    rows={2} placeholder="REGION=eu-central"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setStackModal(false)}>Cancel</Button>
            <Button type="submit" disabled={psSaving || psSteps.length === 0}>{psSaving ? 'Saving…' : editStack ? 'Save' : 'Add'}</Button>
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

      {/* Parameter Modal */}
      <Modal open={paramModal} onClose={() => setParamModal(false)} title={editParam ? 'Edit Parameter' : 'Add Parameter'} size="md">
        <form onSubmit={handleSaveParam} className="space-y-4">
          {paramError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{paramError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Variable Name" value={paramForm.name} onChange={(e) => setParamForm((f) => ({ ...f, name: e.target.value }))} required
              hint="Terraform variable name — sent as TF_VAR_name" />
            <Input label="Display Label" value={paramForm.label} onChange={(e) => setParamForm((f) => ({ ...f, label: e.target.value }))}
              hint="User-facing name shown in the order form" />
          </div>
          <Select label="Type" value={paramForm.type}
            onChange={(e) => setParamForm((f) => ({ ...f, type: e.target.value as ParameterType }))}
            options={[
              { value: 'string', label: 'String' },
              { value: 'number', label: 'Number' },
              { value: 'bool', label: 'Boolean' },
              { value: 'dropdown', label: 'Dropdown' },
            ]} />
          <Input label="Description" value={paramForm.description}
            onChange={(e) => setParamForm((f) => ({ ...f, description: e.target.value }))} />
          <Input label="Default Value" value={paramForm.defaultValue}
            onChange={(e) => setParamForm((f) => ({ ...f, defaultValue: e.target.value }))}
            hint={paramForm.type === 'dropdown' ? 'Comma-separated options' : undefined} />
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="param-required" checked={paramForm.required}
                onChange={(e) => setParamForm((f) => ({ ...f, required: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="param-required" className="text-sm font-medium text-slate-700">Required</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="param-sensitive" checked={paramForm.sensitive}
                onChange={(e) => setParamForm((f) => ({ ...f, sensitive: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="param-sensitive" className="text-sm font-medium text-slate-700">Sensitive</label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setParamModal(false)}>Cancel</Button>
            <Button type="submit" disabled={paramSaving}>{paramSaving ? 'Saving…' : editParam ? 'Save' : 'Add'}</Button>
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
