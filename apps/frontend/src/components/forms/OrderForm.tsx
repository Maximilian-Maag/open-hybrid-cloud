'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ProductDetail,
  Project,
  CostCenter,
  CreateOrderRequest,
  Order,
  InfrastructureElement,
} from '@open-hybrid-cloud/types'
import { post, get } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Select } from '@/components/ui/Select'
import { ParameterFields } from './ParameterFields'
import { t } from '@/lib/i18n'
import { convertPrice } from '@/lib/locale'

interface OrderFormProps {
  product: ProductDetail
  projects: Project[]
  costCenters: CostCenter[]
  token: string
  lang?: string
  exchangeRates?: Record<string, number>
  localeCurrency?: string
}

export function OrderForm({ product, projects, costCenters, token, lang = 'en', exchangeRates = {}, localeCurrency = 'EUR' }: OrderFormProps) {
  const router = useRouter()
  const [envId, setEnvId] = useState<string>('')
  const [projectId, setProjectId] = useState<string>('')
  const [costCenterId, setCostCenterId] = useState<string>('')
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [templates, setTemplates] = useState<InfrastructureElement[]>([])
  const [templateId, setTemplateId] = useState<string>('')

  // Parameter definitions for the selected environment. The page loads the
  // product without an environment (it is picked here), so the server can only
  // return one candidate per name *per environment* — the scope/environment
  // precedence that decides which one actually applies needs a concrete
  // environment. Refetch with it rather than re-deriving that precedence here,
  // so the rendered controls are exactly the definitions `createOrder`
  // validates against. Falls back to the unresolved list until the fetch lands.
  const [resolvedParameters, setResolvedParameters] = useState(product.parameters)

  useEffect(() => {
    if (!envId) { setResolvedParameters(product.parameters); return }
    let stale = false
    get<ProductDetail>(`/api/catalog/${product.id}?lang=${lang}&environmentId=${envId}`, token)
      .then((detail) => { if (!stale && detail) setResolvedParameters(detail.parameters) })
      .catch(() => { /* keep the unresolved list — submit still validates server-side */ })
    return () => { stale = true }
  }, [envId, product.id, product.parameters, lang, token])

  const selectedEnv = product.environments.find((e) => String(e.environmentId) === envId)
  const needsCostCenter =
    selectedEnv?.costCenterMode === 'select' || selectedEnv?.costCenterMode === 'overhead'
  const envParameters = resolvedParameters.filter(
    (p) => p.environmentId === null || String(p.environmentId) === envId,
  )

  // Load existing deployments for the selected project+product so the user can copy parameters
  useEffect(() => {
    if (!projectId) { setTemplates([]); setTemplateId(''); return }
    get<InfrastructureElement[]>(
      `/api/infrastructure?productId=${product.id}&projectId=${projectId}`,
      token,
    )
      .then((rows) => { setTemplates(rows ?? []); setTemplateId('') })
      .catch(() => { setTemplates([]) })
  }, [projectId, product.id, token])

  function applyTemplate(id: string) {
    const tpl = templates.find((tpl) => String(tpl.id) === id)
    if (!tpl) return
    setTemplateId(id)
    setParamValues(tpl.parameters ?? {})
    if (String(tpl.environmentId) !== envId) setEnvId(String(tpl.environmentId))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!envId || !projectId) {
      setError(t('selectEnvProject', lang))
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Merge defaultValue in for any parameter the user did not touch — the
      // Input placeholder already displays the default, so users expect it to
      // be submitted. ParameterFields is now fully controlled, so paramValues
      // only contains keys the user has actually edited.
      const parametersWithDefaults: Record<string, string> = {}
      for (const p of envParameters) {
        parametersWithDefaults[p.name] = paramValues[p.name] ?? p.defaultValue ?? ''
      }
      const body: CreateOrderRequest = {
        productId: product.id,
        environmentId: Number(envId),
        projectId: Number(projectId),
        parameters: parametersWithDefaults,
        ...(needsCostCenter && costCenterId ? { costCenterId: Number(costCenterId) } : {}),
      }
      await post<Order>('/api/orders', body, token)
      setSuccess(true)
      router.push('/orders')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('orderError', lang))
    } finally {
      setLoading(false)
    }
  }

  function formatEnvPrice(env: ProductDetail['environments'][number]): string {
    const converted = convertPrice(env.price, env.currency, localeCurrency, exchangeRates, lang)
    if (converted.currency !== env.currency) {
      return `${converted.amount} ${converted.currency}`
    }
    return `${env.price} ${env.currency}`
  }

  if (success) {
    return (
      <Alert tone="success">
        {t('orderSuccess', lang)}
      </Alert>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert>
          {error}
        </Alert>
      )}

      <Select
        label={t('environment', lang)}
        required
        value={envId}
        onChange={(e) => setEnvId(e.target.value)}
        placeholder={t('selectEnvironment', lang)}
        options={product.environments.map((env) => ({
          value: env.environmentId,
          label: `${env.environmentName ?? `Env ${env.environmentId}`} — ${formatEnvPrice(env)}`,
        }))}
      />

      <Select
        label={t('project', lang)}
        required
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        placeholder={t('selectProject', lang)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
      />

      {needsCostCenter && (
        <Select
          label={t('costCenter', lang)}
          required={selectedEnv?.forcedCostCenter}
          value={costCenterId}
          onChange={(e) => setCostCenterId(e.target.value)}
          placeholder={t('selectCostCenter', lang)}
          options={costCenters
            .filter((cc) => cc.active)
            .map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.name}` }))}
        />
      )}

      {projectId && templates.length > 0 && (
        <div>
          <Select
            label={t('loadFromExisting', lang)}
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            placeholder={t('startFresh', lang)}
            options={templates.map((tpl) => ({
              value: tpl.id,
              label: `#${tpl.id} · ${tpl.environmentName ?? `Env ${tpl.environmentId}`} · ${tpl.deployedAt ? new Date(tpl.deployedAt).toLocaleDateString() : 'n/a'}`,
            }))}
          />
          {templateId && (
            <p className="mt-1 text-xs text-slate-500">
              {t('paramsPrefilled', lang)}{templateId}. Edit as needed before submitting.
            </p>
          )}
        </div>
      )}

      {envId && envParameters.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{t('parameters', lang)}</h3>
          <ParameterFields
            parameters={envParameters}
            values={paramValues}
            onChange={setParamValues}
          />
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t('submitting', lang) : t('placeOrder', lang)}
      </Button>
    </form>
  )
}
