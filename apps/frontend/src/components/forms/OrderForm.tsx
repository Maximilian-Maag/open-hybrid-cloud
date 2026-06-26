'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ProductDetail,
  Project,
  CostCenter,
  CreateOrderRequest,
  Order,
} from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ParameterFields } from './ParameterFields'

interface OrderFormProps {
  product: ProductDetail
  projects: Project[]
  costCenters: CostCenter[]
  token: string
}

export function OrderForm({ product, projects, costCenters, token }: OrderFormProps) {
  const router = useRouter()
  const [envId, setEnvId] = useState<string>('')
  const [projectId, setProjectId] = useState<string>('')
  const [costCenterId, setCostCenterId] = useState<string>('')
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const selectedEnv = product.environments.find((e) => String(e.environmentId) === envId)
  const needsCostCenter =
    selectedEnv?.costCenterMode === 'select' || selectedEnv?.costCenterMode === 'overhead'
  const envParameters = product.parameters.filter(
    (p) => p.environmentId === null || String(p.environmentId) === envId,
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!envId || !projectId) {
      setError('Please select an environment and project.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const body: CreateOrderRequest = {
        productId: product.id,
        environmentId: Number(envId),
        projectId: Number(projectId),
        parameters: paramValues,
        ...(needsCostCenter && costCenterId ? { costCenterId: Number(costCenterId) } : {}),
      }
      await post<Order>('/api/orders', body, token)
      setSuccess(true)
      router.push('/orders')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit order.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
        Order submitted successfully! Redirecting…
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Select
        label="Environment"
        required
        value={envId}
        onChange={(e) => setEnvId(e.target.value)}
        placeholder="Select environment…"
        options={product.environments.map((env) => ({
          value: env.environmentId,
          label: `${env.environmentName ?? `Env ${env.environmentId}`} — ${env.price} ${env.currency}`,
        }))}
      />

      <Select
        label="Project"
        required
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        placeholder="Select project…"
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
      />

      {needsCostCenter && (
        <Select
          label="Cost Center"
          required={selectedEnv?.forcedCostCenter}
          value={costCenterId}
          onChange={(e) => setCostCenterId(e.target.value)}
          placeholder="Select cost center…"
          options={costCenters
            .filter((cc) => cc.active)
            .map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.name}` }))}
        />
      )}

      {envId && envParameters.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Parameters</h3>
          <ParameterFields
            parameters={envParameters}
            onChange={setParamValues}
          />
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Submitting…' : 'Place Order'}
      </Button>
    </form>
  )
}
