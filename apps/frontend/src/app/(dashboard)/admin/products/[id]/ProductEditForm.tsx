'use client'

import { useState, useEffect, useCallback } from 'react'
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
  CostCenter,
  OfferingSize,
} from '@open-hybrid-cloud/types'
import { put, post, del, get } from '@/lib/api'
import { generatePipelineYaml } from '@/lib/pipelineStackPreview'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ProductVersionHistory } from './ProductVersionHistory'
import { t, SUPPORTED_LANGUAGES } from '@/lib/i18n'

// All 25, from the single list `SUPPORTED_LANGUAGES` — not the four this used to
// name. Offering `en`, `de`, `fr` and `es` while the app translates its own UI
// into 25 made a `pl`-only or `mt`-only product impossible to create as a base
// language, and every read path outside the catalogue then had no name to show
// for it (#162).
const LANGUAGES = SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))

// Built per render rather than once at module load: the labels go through t(),
// so they depend on the language this page is being rendered in (#244).
function costCenterModes(lang: string): { value: CostCenterMode; label: string }[] {
  return [
    { value: 'project', label: t('costCenterModeProject', lang) },
    { value: 'select', label: t('costCenterModeSelect', lang) },
    { value: 'overhead', label: t('costCenterModeOverhead', lang) },
  ]
}

interface Props {
  product: ProductDetail
  categories: Category[]
  environments: DeploymentEnvironment[]
  translations: ProductTranslation[]
  costCenters: CostCenter[]
<<<<<<< HEAD
  token: string
  /**
   * The language every string on this form renders in. It used to translate only
   * the handful of strings added with the version history, which left the page
   * reading as half-translated rather than as an untranslated corner (#244).
   * Defaults to English for callers that resolve no language — the tests; the
   * page itself always passes what `getLang()` answered.
   */
=======
  /** The rest of this form is English-only admin chrome; only the new strings are translated. */
>>>>>>> origin/dev
  lang?: string
}

export function ProductEditForm({ product, categories, environments, translations: initTranslations, costCenters, lang = 'en' }: Props) {
  const router = useRouter()

  // Basic info
  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(product.description)
  const [categoryId, setCategoryId] = useState(String(product.categoryId))
  const [baseLanguage, setBaseLanguage] = useState(product.baseLanguage)
  // Trust content for the product page (issue #107). Empty means "nobody has
  // said", which the page renders by leaving the row out.
  const [owner, setOwner] = useState(product.owner ?? '')
  const [docsUrl, setDocsUrl] = useState(product.docsUrl ?? '')
  const [changelog, setChangelog] = useState('')
  const [saving, setSaving] = useState(false)
  // Bumped after a save so the history panel refetches and shows the entry the
  // save just created.
  const [historyKey, setHistoryKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Translations
  const [translations, setTranslations] = useState<ProductTranslation[]>(initTranslations)
  // `router.refresh()` re-renders the server component and hands this one a new
  // `translations` prop, but `useState` keeps its first value forever — so after
  // "AI Translate" the list still described the product as it was before the run.
  // `loadTranslation` then found no entry for a language the AI had just written,
  // opened the modal blank, and the save wrote that blank over the new prose. The
  // prop is the server's answer, so state follows it; this only fires on an actual
  // refresh, because a client re-render does not produce new props.
  useEffect(() => {
    setTranslations(initTranslations)
  }, [initTranslations])
  const [translationLang, setTranslationLang] = useState('de')
  const [translationName, setTranslationName] = useState('')
  const [translationDesc, setTranslationDesc] = useState('')
  const [translationLongDesc, setTranslationLongDesc] = useState('')
  const [transModal, setTransModal] = useState(false)
  const [transSaving, setTransSaving] = useState(false)
  const [transError, setTransError] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Webhooks
  const [webhooks, setWebhooks] = useState<ProductWebhook[]>([])
  const [webhookModal, setWebhookModal] = useState(false)
  const [whDeleteError, setWhDeleteError] = useState<string | null>(null)

  // Pipeline Stacks
  const [stacks, setStacks] = useState<PipelineStack[]>([])
  const [stackModal, setStackModal] = useState(false)
  const [stackDeleteError, setStackDeleteError] = useState<string | null>(null)
  const [editStack, setEditStack] = useState<PipelineStack | null>(null)
  const [psName, setPsName] = useState('')
  const [psEnvId, setPsEnvId] = useState('')
  const [psStateKey, setPsStateKey] = useState('hostname')
  type StepForm = {
    template: string
    stateSuffix: string
    execOrder: string
    upstreamRefs: { varName: string; suffix: string }[]
    fixedParams: string
  }
  const [psSteps, setPsSteps] = useState<StepForm[]>([])
  const [psSaving, setPsSaving] = useState(false)
  const [psError, setPsError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
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
        // Sent only when actually changed, and '' is how the form says "clear it".
        // Sending them unconditionally would put "owner, documentation link" in
        // every single history entry (issue #38), including saves that touched
        // neither.
        ...(owner.trim() !== (product.owner ?? '') ? { owner: owner.trim() } : {}),
        ...(docsUrl.trim() !== (product.docsUrl ?? '') ? { docsUrl: docsUrl.trim() } : {}),
        // Optional, and cleared after saving: a changelog note describes one
        // change, so carrying it into the next save would misattribute it.
        ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
      }
      await put(`/api/admin/products/${product.id}`, body)
      setChangelog('')
      setHistoryKey((k) => k + 1)
      setSuccess(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSave', lang))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEnv(envId: number, data: UpsertProductEnvironmentRequest) {
    // Let failures propagate so the row can show an error instead of a false
    // "Saved!" confirmation.
    await put(`/api/admin/products/${product.id}/environments/${envId}`, data)
  }

  async function handleDeleteEnv(envId: number) {
    // Propagates so the row surfaces the reason — most often the 409 the backend
    // returns while infrastructure is still deployed in this environment.
    await del(`/api/admin/products/${product.id}/environments/${envId}`)
    router.refresh()
  }

  /**
   * Point the translation modal at one language, starting from whatever is already
   * stored for it.
   *
   * The endpoint is an upsert keyed on the language, so opening this on a language
   * that already has a translation is an edit. It used to open blank whatever the
   * language, and this form always sends `longDescription` — so re-saving a
   * translation to fix a typo in its name wrote an empty long description over the
   * prose the product page shows. Loading the stored values in is what makes the
   * fields mean "what will be saved" rather than "what you retype"; omitting the
   * untouched field instead would fix the erasure but still show the author an empty
   * box next to text that exists.
   */
  function loadTranslation(code: string) {
    const existing = translations.find((x) => x.languageCode === code)
    setTranslationLang(code)
    setTranslationName(existing?.name ?? '')
    setTranslationDesc(existing?.description ?? '')
    setTranslationLongDesc(existing?.longDescription ?? '')
  }

  async function handleAddTranslation(e: React.FormEvent) {
    e.preventDefault()
    setTransSaving(true)
    setTransError(null)
    try {
      await put(`/api/admin/products/${product.id}/translations/${translationLang}`, {
        name: translationName.trim(),
        description: translationDesc.trim(),
        // Always sent from this form, because this form is where it is edited —
        // the endpoint leaves it alone only for callers that omit it. Safe to send
        // unconditionally only because `loadTranslation` put the stored value in the
        // box first; without that this line is an erase.
        longDescription: translationLongDesc.trim(),
      })
      const updated = await post<ProductTranslation[]>(`/api/admin/products/${product.id}/translations`, {})
        .catch(() => null)
      if (updated) setTranslations(updated)
      else {
        const added: ProductTranslation = {
          productId: product.id,
          languageCode: translationLang,
          name: translationName.trim(),
          description: translationDesc.trim(),
          longDescription: translationLongDesc.trim(),
        }
        setTranslations((prev) => {
          const idx = prev.findIndex((x) => x.languageCode === translationLang)
          if (idx >= 0) { const next = [...prev]; next[idx] = added; return next }
          return [...prev, added]
        })
      }
      setTransModal(false)
    } catch (err) {
      setTransError(err instanceof Error ? err.message : t('failedToSave', lang))
    } finally {
      setTransSaving(false)
    }
  }

  async function handleAiTranslate() {
    setTranslating(true)
    setAiError(null)
    try {
      await post(`/api/admin/products/${product.id}/translate`, {})
      router.refresh()
    } catch (e) {
      setAiError(e instanceof Error ? e.message : t('aiTranslationFailed', lang))
    } finally {
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
      const created = await post<ProductWebhook>(`/api/admin/products/${product.id}/webhooks`, body)
      setWebhooks((prev) => [...prev, created])
      setWebhookModal(false)
      setWhName(''); setWhUrl(''); setWhToken(''); setWhOrder('0')
    } catch (err) {
      setWhError(err instanceof Error ? err.message : t('failedToCreateGeneric', lang))
    } finally {
      setWhSaving(false)
    }
  }

  async function handleDeleteWebhook(whId: number) {
    setWhDeleteError(null)
    try {
      await del(`/api/admin/products/${product.id}/webhooks/${whId}`)
      setWebhooks((prev) => prev.filter((w) => w.id !== whId))
    } catch (e) {
      setWhDeleteError(e instanceof Error ? e.message : t('failedToDeleteGeneric', lang))
    }
  }

  useEffect(() => {
    get<PipelineStack[]>(`/api/admin/products/${product.id}/pipeline-stacks`)
      .then(setStacks)
      .catch(() => { /* the section renders empty; the add form below still works */ })
  }, [product.id])

  // Order Callbacks, same shape as the pipeline stacks fetch above. Without
  // this, `webhooks` was only ever written by add/delete — reloading the page
  // made every existing callback invisible and its Delete button unreachable
  // (#145).
  useEffect(() => {
    get<ProductWebhook[]>(`/api/admin/products/${product.id}/webhooks`)
      .then(setWebhooks)
      .catch(() => { /* the section renders empty; the add form below still works */ })
  }, [product.id])

  function openStackModal() {
    setPsError(null)
    setEditStack(null)
    setPsName(''); setPsEnvId(''); setPsStateKey('hostname'); setPsSteps([])
    setStackModal(true)
  }

  function openEditStackModal(stack: PipelineStack) {
    setPsError(null)
    setEditStack(stack)
    setPsName(stack.name)
    setPsEnvId(String(stack.environmentId))
    setPsStateKey(stack.stateKeyParam)
    setPsSteps(stack.steps.map((s) => ({
      template: s.template,
      stateSuffix: s.stateSuffix,
      execOrder: String(s.execOrder ?? 0),
      upstreamRefs: (s.upstreamRefs ?? []).map((r) => ({ varName: r.varName, suffix: r.suffix })),
      fixedParams: s.fixedParams ? Object.entries(s.fixedParams).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    })))
    setStackModal(true)
  }

  function addStep() {
    setPsSteps((prev) => [
      ...prev,
      { template: '', stateSuffix: '', execOrder: String(prev.length), upstreamRefs: [], fixedParams: '' },
    ])
  }

  function removeStep(i: number) {
    setPsSteps((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateStep(i: number, field: keyof StepForm, value: string) {
    setPsSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  function addUpstreamRef(stepIdx: number) {
    setPsSteps((prev) => prev.map((s, idx) => idx === stepIdx
      ? { ...s, upstreamRefs: [...s.upstreamRefs, { varName: '', suffix: '' }] }
      : s))
  }

  function removeUpstreamRef(stepIdx: number, refIdx: number) {
    setPsSteps((prev) => prev.map((s, idx) => idx === stepIdx
      ? { ...s, upstreamRefs: s.upstreamRefs.filter((_, ri) => ri !== refIdx) }
      : s))
  }

  function updateUpstreamRef(stepIdx: number, refIdx: number, field: 'varName' | 'suffix', value: string) {
    setPsSteps((prev) => prev.map((s, idx) => idx === stepIdx
      ? { ...s, upstreamRefs: s.upstreamRefs.map((r, ri) => ri === refIdx ? { ...r, [field]: value } : r) }
      : s))
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
        const upstreamRefs = s.upstreamRefs
          .map((r) => ({ varName: r.varName.trim(), suffix: r.suffix.trim() }))
          .filter((r) => r.varName && r.suffix)
        return {
          template: s.template.trim(),
          stateSuffix: s.stateSuffix.trim(),
          execOrder: Number(s.execOrder) || 0,
          ...(upstreamRefs.length ? { upstreamRefs } : {}),
          ...(fixedParams ? { fixedParams } : {}),
        }
      })
      if (editStack) {
        const body: UpdatePipelineStackRequest = {
          name: psName.trim(),
          stateKeyParam: psStateKey.trim() || 'hostname',
          steps,
        }
        const updated = await put<PipelineStack>(`/api/admin/products/${product.id}/pipeline-stacks/${editStack.id}`, body)
        setStacks((prev) => prev.map((s) => s.id === editStack.id ? updated : s))
      } else {
        const body: CreatePipelineStackRequest = {
          environmentId: Number(psEnvId),
          name: psName.trim(),
          stateKeyParam: psStateKey.trim() || 'hostname',
          steps,
        }
        const created = await post<PipelineStack>(`/api/admin/products/${product.id}/pipeline-stacks`, body)
        setStacks((prev) => [...prev, created])
      }
      setStackModal(false)
    } catch (err) {
      setPsError(err instanceof Error ? err.message : t('failedToSave', lang))
    } finally {
      setPsSaving(false)
    }
  }

  async function handleDeleteStack(stackId: number) {
    setStackDeleteError(null)
    try {
      await del(`/api/admin/products/${product.id}/pipeline-stacks/${stackId}`)
      setStacks((prev) => prev.filter((s) => s.id !== stackId))
    } catch (e) {
      setStackDeleteError(e instanceof Error ? e.message : t('failedToDeleteGeneric', lang))
    }
  }

  async function handleSyncParams() {
    setParamSyncing(true)
    setParamSyncMsg(null)
    setParamError(null)
    try {
      const result = await post<{ created: number; skipped: number }>(
        `/api/admin/products/${product.id}/sync-parameters`, {},
      )
      const refreshed = await get<Parameter[]>(
        `/api/admin/parameters?scope=product&scopeId=${product.id}`,
      )
      if (refreshed) setProductParams(refreshed)
      // A label and a number rather than an inflected sentence: "3 parameters"
      // takes a different plural form in most of the 25 languages and the table
      // has no placeholder syntax to carry one.
      setParamSyncMsg(
        `${t('parametersImported', lang)}: ${result.created}` +
        (result.skipped ? ` · ${t('alreadyExisted', lang)}: ${result.skipped}` : ''),
      )
    } catch (e) {
      setParamError(e instanceof Error ? e.message : t('genericFailed', lang))
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
        const updated = await put<Parameter>(`/api/admin/parameters/${editParam.id}`, body)
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
        const created = await post<Parameter>('/api/admin/parameters', body)
        setProductParams((prev) => [...prev, created])
      }
      setParamModal(false)
    } catch (err) {
      setParamError(err instanceof Error ? err.message : t('failedToSave', lang))
    } finally {
      setParamSaving(false)
    }
  }

  async function handleDeleteParam(paramId: number) {
    setParamError(null)
    setParamSyncMsg(null)
    try {
      await del(`/api/admin/parameters/${paramId}`)
      setProductParams((prev) => prev.filter((p) => p.id !== paramId))
    } catch (e) {
      setParamError(e instanceof Error ? e.message : t('failedToDeleteGeneric', lang))
    }
  }

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card title={t('basicInformation', lang)}>
        <form onSubmit={handleSaveBasic} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          {success && <Alert tone="success">{t('saved', lang)}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('category', lang)} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required
              options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <Select label={t('baseLanguage', lang)} value={baseLanguage} onChange={(e) => setBaseLanguage(e.target.value)}
              options={LANGUAGES} />
          </div>
          <Input label={t('name', lang)} value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label htmlFor="product-description" className="text-sm font-medium text-slate-700">{t('description', lang)}</label>
            <textarea id="product-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {/* What the product page shows under "Good to know" (issue #107). Both
              optional: the page omits whichever is empty rather than showing a
              blank row. */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('owner', lang)}
              value={owner}
              maxLength={200}
              onChange={(e) => setOwner(e.target.value)}
              placeholder={t('ownerPlaceholder', lang)}
              hint={t('ownerHint', lang)}
            />
            <Input
              label={t('documentationLink', lang)}
              value={docsUrl}
              maxLength={2000}
              onChange={(e) => setDocsUrl(e.target.value)}
              // A URL scheme, not prose: the same in every language.
              placeholder="https://…"
              hint={t('docsUrlHint', lang)}
            />
          </div>
          {/* Optional, per the issue. Cleared after saving, since a note describes
              one change and carrying it forward would misattribute it. */}
          <div className="flex flex-col gap-1">
            <label htmlFor="product-changelog" className="text-sm font-medium text-slate-700">
              {t('changelog', lang)}
            </label>
            <textarea
              id="product-changelog"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={t('changelogHint', lang)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-slate-500">{t('changelogHint', lang)}</p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>{saving ? t('saving', lang) : t('save', lang)}</Button>
          </div>
        </form>
      </Card>

      {/* Version history (issue #38) */}
      <Card title={t('versionHistory', lang)}>
        <ProductVersionHistory key={historyKey} productId={product.id} lang={lang} />
      </Card>

      {/* Translations */}
      <Card title={t('translationsTitle', lang)} action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleAiTranslate} disabled={translating}>
            {translating ? t('translating', lang) : t('aiTranslate', lang)}
          </Button>
          <Button size="sm" onClick={() => { loadTranslation(translationLang); setTransError(null); setTransModal(true) }}>
            {t('addTranslation', lang)}
          </Button>
        </div>
      }>
        {aiError && (
          <Alert className="mb-3">
            {aiError}
          </Alert>
        )}
        {translations.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noTranslationsYet', lang)}</p>
        ) : (
          <div className="space-y-2">
            {translations.map((tr) => (
              <div key={tr.languageCode} className="rounded-lg border border-slate-100 p-3">
                <span className="text-xs font-mono text-slate-600 uppercase">{tr.languageCode}</span>
                <p className="font-medium text-slate-900">{tr.name}</p>
                <p className="text-sm text-slate-500 line-clamp-2">{tr.description}</p>
                {tr.longDescription && (
                  <p className="mt-1 text-xs text-slate-400 line-clamp-2">{tr.longDescription}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Environments */}
      <Card title={t('environments', lang)}>
        {environments.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noEnvironmentsConfigured', lang)}</p>
        ) : (
          <div className="space-y-4">
            {environments.map((env) => {
              const existing = product.environments.find((e) => e.environmentId === env.id)
              return (
                <EnvironmentRow
                  key={env.id}
                  env={env}
                  existing={existing}
                  costCenters={costCenters}
                  productId={product.id}
                  onSave={(data) => handleSaveEnv(env.id, data)}
                  onDelete={() => handleDeleteEnv(env.id)}
                  lang={lang}
                />
              )
            })}
          </div>
        )}
      </Card>

      {/* Parameters */}
      <Card title={t('parameters', lang)} action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleSyncParams}
            disabled={paramSyncing || stacks.length === 0}
            title={stacks.length === 0 ? t('addPipelineStackFirst', lang) : t('importFromTemplateVariables', lang)}>
            {paramSyncing ? t('syncing', lang) : t('syncFromTemplate', lang)}
          </Button>
          <Button size="sm" onClick={openAddParamModal}>{t('addParameter', lang)}</Button>
        </div>
      }>
        {paramSyncMsg && <Alert tone="success" className="mb-3">{paramSyncMsg}</Alert>}
        {/* Only when the modal is closed: the modal renders paramError itself,
            and two role="alert" regions with the same text are announced twice. */}
        {paramError && !paramModal && <Alert className="mb-3">{paramError}</Alert>}
        {productParams.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noParametersYetHint', lang)}</p>
        ) : (
          <div className="space-y-2">
            {productParams.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-slate-900">{p.label || p.name}</p>
                    <span className="font-mono text-xs text-slate-600">{p.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.type}</span>
                    {/* red-700, not red-600: this 12px badge sits on red-100 (#ffe2e2), where
                        red-600 (#e7000b) measures 3.91:1 — below the 4.5:1 AA needs for text
                        this size. red-700 (#c10007) on the same ground is 5.27:1. */}
                    {p.required && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{t('requiredBadge', lang)}</span>}
                    {p.sensitive && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">{t('sensitiveBadge', lang)}</span>}
                  </div>
                  {p.description && <p className="text-xs text-slate-500">{p.description}</p>}
                  {p.defaultValue && <p className="text-xs text-slate-600 font-mono">{t('defaultPrefix', lang)}: {p.defaultValue}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEditParamModal(p)}>{t('edit', lang)}</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDeleteParam(p.id)}>{t('delete', lang)}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Order Callbacks */}
      <Card title={t('orderCallbacks', lang)} action={
        <Button size="sm" onClick={() => { setWhError(null); setWebhookModal(true) }}>{t('addWebhook', lang)}</Button>
      }>
        <p className="text-xs text-slate-500 mb-3">{t('orderCallbacksIntro', lang)}</p>
        {whDeleteError && <Alert className="mb-3">{whDeleteError}</Alert>}
        {webhooks.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noCallbacksConfigured', lang)}</p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((wh) => (
              <div key={wh.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                <div>
                  <p className="font-medium text-slate-900">{wh.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{wh.webhookUrl}</p>
                </div>
                <Button size="sm" variant="danger" onClick={() => handleDeleteWebhook(wh.id)}>{t('delete', lang)}</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pipeline Stacks */}
      <Card title={t('pipelineStacks', lang)} action={
        <Button size="sm" onClick={openStackModal}>{t('addStack', lang)}</Button>
      }>
        {stackDeleteError && <Alert className="mb-3">{stackDeleteError}</Alert>}
        {stacks.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noPipelineStacksYet', lang)}</p>
        ) : (
          <div className="space-y-2">
            {stacks.map((s) => {
              const env = environments.find((e) => e.id === s.environmentId)
              return (
                <div key={s.id} data-testid="stack-item" className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                  <div>
                    <p className="font-medium text-slate-900">{s.name}</p>
                    {/* A bare count rather than an inflected "1 step / 2 steps":
                        the plural rules differ across the 25 languages and the
                        table has no placeholder syntax to carry them. */}
                    <p className="text-xs text-slate-500">{env?.name ?? `${t('environment', lang)} #${s.environmentId}`} &middot; {s.steps.length} {t('stepsLower', lang)} &middot; {t('stateKeyShort', lang)}: <span className="font-mono">{s.stateKeyParam}</span></p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEditStackModal(s)}>{t('edit', lang)}</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteStack(s.id)}>{t('delete', lang)}</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Translation Modal */}
      <Modal
        open={transModal}
        onClose={() => setTransModal(false)}
        title={translations.some((x) => x.languageCode === translationLang) ? t('editTranslation', lang) : t('addTranslation', lang)}
        size="md"
      >
        <form onSubmit={handleAddTranslation} className="space-y-4">
          {transError && <Alert>{transError}</Alert>}
          {/* Switching language re-points the whole form, so the fields keep
              describing the language named above them. */}
          <Select label={t('language', lang)} value={translationLang} onChange={(e) => loadTranslation(e.target.value)} options={LANGUAGES} />
          <Input label={t('name', lang)} value={translationName} onChange={(e) => setTranslationName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label htmlFor="translation-description" className="text-sm font-medium text-slate-700">{t('description', lang)}</label>
            <textarea id="translation-description" value={translationDesc} onChange={(e) => setTranslationDesc(e.target.value)} rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-slate-500">{t('translationDescriptionHint', lang)}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="translation-long-description" className="text-sm font-medium text-slate-700">
              {t('longDescription', lang)}
            </label>
            <textarea id="translation-long-description" value={translationLongDesc}
              onChange={(e) => setTranslationLongDesc(e.target.value)} rows={6} maxLength={20000}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-slate-500">{t('longDescriptionHint', lang)}</p>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setTransModal(false)}>{t('cancel', lang)}</Button>
            <Button type="submit" disabled={transSaving}>{transSaving ? t('saving', lang) : t('save', lang)}</Button>
          </div>
        </form>
      </Modal>

      {/* Pipeline Stack Modal */}
      <Modal open={stackModal} onClose={() => setStackModal(false)} title={editStack ? t('editPipelineStack', lang) : t('addPipelineStack', lang)} size="lg">
        <form onSubmit={handleSaveStack} className="space-y-4">
          {psError && <Alert>{psError}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('name', lang)} value={psName} onChange={(e) => setPsName(e.target.value)} required />
            <Select label={t('environment', lang)} required={!editStack} value={psEnvId} onChange={(e) => setPsEnvId(e.target.value)}
              placeholder={t('selectEnvironment', lang)} options={environments.map((e) => ({ value: e.id, label: e.name }))}
              disabled={!!editStack} />
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
            {t('pipelineStackInheritNotice', lang)}{' '}
            {t('manageThemIn', lang)} <strong>{t('admin', lang)} → {t('environments', lang)}</strong>.
          </div>
          {/* `hostname` is the parameter name the pipeline actually reads, not
              prose — it stays as it is in every language. */}
          <Input label={t('stateKeyParameter', lang)} value={psStateKey} onChange={(e) => setPsStateKey(e.target.value)}
            placeholder="hostname" />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">{t('steps', lang)}</label>
              <Button type="button" size="sm" variant="secondary" onClick={addStep}>{t('addStep', lang)}</Button>
            </div>
            {psSteps.length === 0 && (
              <p className="text-sm text-slate-600">{t('noStepsYet', lang)}</p>
            )}
            {psSteps.map((step, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">{t('step', lang)} {i + 1}</span>
                  <Button type="button" size="sm" variant="danger" onClick={() => removeStep(i)}>{t('remove', lang)}</Button>
                </div>
                {/* The placeholders here are template paths, state suffixes and an
                    index — values the pipeline consumes verbatim, so they are the
                    same in every language. The hints beside them are prose. */}
                <div className="grid grid-cols-3 gap-2">
                  <Input label={t('template', lang)} placeholder="linode/virtual-machine" value={step.template}
                    onChange={(e) => updateStep(i, 'template', e.target.value)} required
                    hint={t('templateHint', lang)} />
                  <Input label={t('stateSuffix', lang)} placeholder="-vm" value={step.stateSuffix}
                    onChange={(e) => updateStep(i, 'stateSuffix', e.target.value)} required
                    hint={t('stateSuffixHint', lang)} />
                  <Input label={t('execOrder', lang)} type="number" min={0} placeholder="0" value={step.execOrder}
                    onChange={(e) => updateStep(i, 'execOrder', e.target.value)}
                    hint={t('execOrderHint', lang)} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">{t('upstreamStateRefs', lang)}</label>
                    <Button type="button" size="sm" variant="secondary" onClick={() => addUpstreamRef(i)}>{t('addRef', lang)}</Button>
                  </div>
                  <p className="text-xs text-slate-500">{t('upstreamStateRefsHint', lang)}</p>
                  {step.upstreamRefs.length === 0 && (
                    <p className="text-xs text-slate-600 italic">{t('noUpstreamRefs', lang)}</p>
                  )}
                  {step.upstreamRefs.map((ref, ri) => (
                    <div key={ri} className="flex gap-2 items-end">
                      <Input label={t('varName', lang)} placeholder="VM_STATE_NAME" value={ref.varName}
                        onChange={(e) => updateUpstreamRef(i, ri, 'varName', e.target.value)} />
                      <Input label={t('fromSuffix', lang)} placeholder="-vm" value={ref.suffix}
                        onChange={(e) => updateUpstreamRef(i, ri, 'suffix', e.target.value)} />
                      {/* The visible label is a multiplication sign, which is the
                          whole accessible name a screen reader would otherwise
                          announce — so the name is spelled out separately. */}
                      <Button type="button" size="sm" variant="danger" aria-label={t('remove', lang)}
                        onClick={() => removeUpstreamRef(i, ri)}>×</Button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  {/* Indexed id: this block is rendered once per pipeline step, so a
                      fixed one would tie every step's label to the first textarea. */}
                  <label htmlFor={`step-fixed-params-${i}`} className="text-sm font-medium text-slate-700">{t('fixedParametersOptional', lang)}</label>
                  <p className="text-xs text-slate-500">{t('fixedParametersHint', lang)}</p>
                  <textarea id={`step-fixed-params-${i}`} value={step.fixedParams} onChange={(e) => updateStep(i, 'fixedParams', e.target.value)}
                    rows={2} placeholder="REGION=eu-central"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setStackModal(false)}>{t('cancel', lang)}</Button>
            <Button type="button" variant="secondary" disabled={psSteps.length === 0}
              onClick={() => setPreviewOpen(true)}>{t('previewYaml', lang)}</Button>
            <Button type="submit" disabled={psSaving || psSteps.length === 0}>{psSaving ? t('saving', lang) : editStack ? t('save', lang) : t('add', lang)}</Button>
          </div>
        </form>
      </Modal>

      {/* Pipeline YAML Preview Modal */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('generatedPipelineYaml', lang)} size="lg">
        <pre className="rounded-lg bg-slate-900 text-slate-100 text-xs font-mono p-4 overflow-x-auto max-h-[60vh] overflow-y-auto whitespace-pre">
{generatePipelineYaml(psSteps, psStateKey || 'hostname', 'apply')}
        </pre>
        <div className="flex justify-end mt-4">
          <Button type="button" variant="secondary" onClick={() => setPreviewOpen(false)}>{t('close', lang)}</Button>
        </div>
      </Modal>

      {/* Webhook Modal */}
      <Modal open={webhookModal} onClose={() => setWebhookModal(false)} title={t('addWebhook', lang)} size="md">
        <form onSubmit={handleAddWebhook} className="space-y-4">
          {whError && <Alert>{whError}</Alert>}
          <Select label={t('environment', lang)} required value={whEnvId} onChange={(e) => setWhEnvId(e.target.value)}
            placeholder={t('selectEnvironment', lang)} options={environments.map((e) => ({ value: e.id, label: e.name }))} />
          <Input label={t('name', lang)} value={whName} onChange={(e) => setWhName(e.target.value)} required />
          <Input label={t('webhookUrl', lang)} type="url" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} required />
          <Input label={t('webhookToken', lang)} value={whToken} onChange={(e) => setWhToken(e.target.value)} />
          <Input label={t('executionOrder', lang)} type="number" value={whOrder} onChange={(e) => setWhOrder(e.target.value)} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setWebhookModal(false)}>{t('cancel', lang)}</Button>
            <Button type="submit" disabled={whSaving}>{whSaving ? t('saving', lang) : t('add', lang)}</Button>
          </div>
        </form>
      </Modal>

      {/* Parameter Modal */}
      <Modal open={paramModal} onClose={() => setParamModal(false)} title={editParam ? t('editParameter', lang) : t('addParameter', lang)} size="md">
        <form onSubmit={handleSaveParam} className="space-y-4">
          {paramError && <Alert>{paramError}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            {/* The same keys the global parameters admin uses for the same two
                fields — one wording for one concept. */}
            <Input label={t('variableName', lang)} value={paramForm.name} onChange={(e) => setParamForm((f) => ({ ...f, name: e.target.value }))} required
              hint={t('variableNameHint', lang)} />
            <Input label={t('displayLabel', lang)} value={paramForm.label} onChange={(e) => setParamForm((f) => ({ ...f, label: e.target.value }))}
              hint={t('displayLabelHint', lang)} />
          </div>
          <Select label={t('type', lang)} value={paramForm.type}
            onChange={(e) => setParamForm((f) => ({ ...f, type: e.target.value as ParameterType }))}
            options={[
              { value: 'string', label: t('typeString', lang) },
              { value: 'number', label: t('typeNumber', lang) },
              { value: 'bool', label: t('typeBoolean', lang) },
              { value: 'dropdown', label: t('typeDropdown', lang) },
            ]} />
          <Input label={t('description', lang)} value={paramForm.description}
            onChange={(e) => setParamForm((f) => ({ ...f, description: e.target.value }))} />
          <Input label={t('defaultValue', lang)} value={paramForm.defaultValue}
            onChange={(e) => setParamForm((f) => ({ ...f, defaultValue: e.target.value }))}
            hint={paramForm.type === 'dropdown' ? t('commaSeparatedOptions', lang) : undefined} />
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="param-required" checked={paramForm.required}
                onChange={(e) => setParamForm((f) => ({ ...f, required: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="param-required" className="text-sm font-medium text-slate-700">{t('required', lang)}</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="param-sensitive" checked={paramForm.sensitive}
                onChange={(e) => setParamForm((f) => ({ ...f, sensitive: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="param-sensitive" className="text-sm font-medium text-slate-700">{t('sensitive', lang)}</label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setParamModal(false)}>{t('cancel', lang)}</Button>
            <Button type="submit" disabled={paramSaving}>{paramSaving ? t('saving', lang) : editParam ? t('save', lang) : t('add', lang)}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function EnvironmentRow({
  env,
  existing,
  costCenters,
  productId,
  onSave,
  onDelete,
  lang,
}: {
  env: DeploymentEnvironment
  existing?: {
    price: string
    currency: string
    costCenterMode: CostCenterMode
    forcedCostCenter: boolean
    overheadCostCenterId: number | null
    trialEnabled: boolean
    trialDurationMinutes: number
  }
  costCenters: CostCenter[]
  productId: number
  onSave: (data: UpsertProductEnvironmentRequest) => Promise<void>
  onDelete: () => Promise<void>
  lang: string
}) {
  const [price, setPrice] = useState(existing?.price ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? 'EUR')
  const [costCenterMode, setCostCenterMode] = useState<CostCenterMode>(existing?.costCenterMode ?? 'project')
  const [forcedCostCenter, setForcedCostCenter] = useState(existing?.forcedCostCenter ?? false)
  const [trialEnabled, setTrialEnabled] = useState(existing?.trialEnabled ?? false)
  const [trialDurationMinutes, setTrialDurationMinutes] = useState(
    String(existing?.trialDurationMinutes ?? 30),
  )
  const [overheadCostCenterId, setOverheadCostCenterId] = useState(
    existing?.overheadCostCenterId !== null && existing?.overheadCostCenterId !== undefined
      ? String(existing.overheadCostCenterId)
      : '',
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await onSave({
        price,
        currency,
        costCenterMode,
        forcedCostCenter,
        // Only meaningful for `overhead`; sending null otherwise keeps a stale
        // account from being applied if the mode is switched back later.
        overheadCostCenterId:
          costCenterMode === 'overhead' && overheadCostCenterId ? Number(overheadCostCenterId) : null,
        trialEnabled,
        // Fall back to 30 rather than sending NaN or 0 for a cleared field: the
        // server rejects a non-positive duration, which would surface as a
        // confusing save error on a field the operator may not have touched.
        trialDurationMinutes: Number(trialDurationMinutes) > 0 ? Number(trialDurationMinutes) : 30,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('failedToSave', lang))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setRemoving(true)
    setSaveError(null)
    try {
      await onDelete()
      setConfirmRemove(false)
    } catch (err) {
      // Keep the dialog open so the reason stays next to the action that failed
      // — a 409 here means the operator has to decommission first.
      setSaveError(err instanceof Error ? err.message : t('failedToDeleteGeneric', lang))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="rounded-lg border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-slate-900">{env.name}</h4>
        {existing && (
          <Button type="button" size="sm" variant="danger" onClick={() => { setSaveError(null); setConfirmRemove(true) }}>
            {t('remove', lang)}
          </Button>
        )}
      </div>
      {/* The placeholders are a number format and a currency code, neither of
          which changes with the interface language. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Input label={t('price', lang)} value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="0.00"
          hint={t('priceSizesHint', lang)} />
        <Input label={t('currency', lang)} value={currency} onChange={(e) => setCurrency(e.target.value)} required placeholder="EUR" />
        <Select label={t('costCenterMode', lang)} value={costCenterMode}
          onChange={(e) => setCostCenterMode(e.target.value as CostCenterMode)} options={costCenterModes(lang)} />
        <div className="flex flex-col gap-1 justify-end">
          {/* Per-environment id, like `trial-${env.id}` below: this form is rendered
              once per environment, so a fixed id would point every "Forced CC" label
              at the first environment's checkbox. */}
          <label htmlFor={`forced-cc-${env.id}`} className="text-sm font-medium text-slate-700">{t('forcedCostCenterShort', lang)}</label>
          <div className="flex items-center h-9">
            <input type="checkbox" id={`forced-cc-${env.id}`} checked={forcedCostCenter} onChange={(e) => setForcedCostCenter(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      {/* Trials are opt-in per offering: one provisions real infrastructure and
          asks the pipeline to grant elevated rights inside it. */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            id={`trial-${env.id}`}
            checked={trialEnabled}
            onChange={(e) => setTrialEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor={`trial-${env.id}`} className="text-sm font-medium text-slate-700">
            {t('offerAsTrial', lang)}
          </label>
        </div>
        {trialEnabled && (
          <Input
            label={t('trialDurationLabel', lang)}
            type="number"
            min={1}
            value={trialDurationMinutes}
            onChange={(e) => setTrialDurationMinutes(e.target.value)}
            hint={t('trialDurationHint', lang)}
            className="w-64"
          />
        )}
      </div>

      {/* Overhead mode bills every order to one fixed shared account, so it
          needs to name which one — the other two modes never use it. */}
      {costCenterMode === 'overhead' && (
        <Select
          label={t('overheadCostCenter', lang)}
          value={overheadCostCenterId}
          onChange={(e) => setOverheadCostCenterId(e.target.value)}
          placeholder={t('selectCostCenter', lang)}
          hint={
            forcedCostCenter
              ? t('overheadForcedHint', lang)
              : t('overheadOptionalHint', lang)
          }
          options={costCenters
            .filter((cc) => cc.active || String(cc.id) === overheadCostCenterId)
            .map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.name}${cc.active ? '' : ` ${t('inactiveSuffix', lang)}`}` }))}
        />
      )}
<<<<<<< HEAD
      {existing && <SizesEditor productId={productId} envId={env.id} token={token} lang={lang} />}
=======
      {existing && <SizesEditor productId={productId} envId={env.id} />}
>>>>>>> origin/dev

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>{saving ? t('saving', lang) : t('save', lang)}</Button>
        {saved && <span className="text-xs text-green-600">{t('saved', lang)}</span>}
        {/* Only when the dialog is closed: the dialog renders saveError itself,
            and two live regions with the same text are announced twice. */}
        {saveError && !confirmRemove && <span className="text-xs text-red-600" role="alert">{saveError}</span>}
      </div>

      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`${t('remove', lang)} ${env.name}?`} size="md">
        {saveError && <Alert className="mb-3">{saveError}</Alert>}
        <p className="text-sm text-slate-600">
          {t('removeEnvironmentIntro', lang)} <strong>{env.name}</strong>. {t('removeEnvironmentWarning', lang)}
        </p>
        <div className="flex justify-end gap-3 mt-4">
          <Button type="button" variant="secondary" onClick={() => setConfirmRemove(false)}>{t('cancel', lang)}</Button>
          <Button type="button" variant="danger" disabled={removing} onClick={handleRemove}>
            {removing ? t('removing', lang) : t('remove', lang)}
          </Button>
        </div>
      </Modal>
    </form>
  )
}


/**
 * Per-offering size list (issue #98).
 *
 * Lives inside the offering row because a size belongs to a (product,
 * environment) pair: the same product legitimately costs different amounts at the
 * same size in two environments, which is half the point of the feature.
 *
 * Deliberately not a nested <form> — the offering row is already one, and nested
 * forms are invalid HTML — so every control here is a type="button".
 */
function SizesEditor({
  productId,
  envId,
<<<<<<< HEAD
  token,
  lang,
}: {
  productId: number
  envId: number
  token: string
  lang: string
=======
}: {
  productId: number
  envId: number
>>>>>>> origin/dev
}) {
  const [sizes, setSizes] = useState<OfferingSize[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const path = `/api/admin/products/${productId}/environments/${envId}/sizes`

  const load = useCallback(async () => {
    try {
      setSizes((await get<OfferingSize[]>(path)) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToLoadGeneric', lang))
      setSizes([])
    }
<<<<<<< HEAD
    // `lang` is in here because the fallback message is translated now. It makes
    // `load` change when the language does, so the sizes are re-fetched on a
    // language switch — one request, and the alternative is a stale error still
    // reading in the previous language.
  }, [path, token, lang])
=======
  }, [path])
>>>>>>> origin/dev

  useEffect(() => { void load() }, [load])

  async function handleAdd() {
    setBusy(true)
    setError(null)
    try {
      await post(path, {
        code: code.trim(),
        label: label.trim(),
        price: price.trim() || '0',
        currency: currency.trim().toUpperCase(),
        // Appended at the end of the list; an admin reorders by editing the value
        // on the row, which upserts on the same code.
        sortOrder: (sizes?.length ?? 0) + 1,
      })
      setCode(''); setLabel(''); setPrice('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSave', lang))
    } finally {
      setBusy(false)
    }
  }

  /** Retire rather than delete: existing orders reference the code. */
  async function handleToggleActive(size: OfferingSize) {
    setBusy(true)
    setError(null)
    try {
      await post(path, { code: size.code, label: size.label, price: size.price,
        currency: size.currency, sortOrder: size.sortOrder, active: !size.active })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToSave', lang))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(size: OfferingSize) {
    setBusy(true)
    setError(null)
    try {
      await del(`${path}/${size.id}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteGeneric', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2">
      <p className="text-sm font-medium text-slate-700">{t('sizes', lang)}</p>
      <p className="text-xs text-slate-500">
        {t('sizesHint', lang)} <code>SIZE</code>.
      </p>
      {error && <Alert>{error}</Alert>}
      {sizes !== null && sizes.length === 0 && (
        <p className="text-xs text-slate-600">{t('noSizes', lang)}</p>
      )}
      {sizes?.map((size) => (
        <div key={size.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <span className="font-mono text-xs text-slate-600">{size.code}</span>
          <span className="text-sm text-slate-900">{size.label}</span>
          <span className="text-sm font-medium text-slate-900">{size.price} {size.currency}</span>
          {!size.active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t('retiredBadge', lang)}</span>
          )}
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy}
              onClick={() => handleToggleActive(size)}>
              {size.active ? t('retire', lang) : t('restore', lang)}
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={busy}
              onClick={() => handleDelete(size)}>{t('delete', lang)}</Button>
          </span>
        </div>
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Input label={t('code', lang)} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XL" />
        <Input label={t('label', lang)} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sizeLabelPlaceholder', lang)} />
        <Input label={t('price', lang)} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        <Input label={t('currency', lang)} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="EUR" />
      </div>
      <Button type="button" size="sm" disabled={busy || code.trim() === ''} onClick={handleAdd}>
        {busy ? t('saving', lang) : t('addOrUpdateSize', lang)}
      </Button>
    </div>
  )
}
