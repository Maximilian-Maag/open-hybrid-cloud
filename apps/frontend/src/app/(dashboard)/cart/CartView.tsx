'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CartItem,
  Project,
  CostCenter,
  Parameter,
  CheckoutRequest,
  CheckoutResponse,
  ProductDetail,
} from '@open-hybrid-cloud/types'
import { get, post, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ParameterFields } from '@/components/forms/ParameterFields'
import { t } from '@/lib/i18n'

interface Props {
  initialItems: CartItem[]
  projects: Project[]
  costCenters: CostCenter[]
  token: string
  lang: string
}

/**
 * Cart overview and single-screen checkout (issue #28).
 *
 * One project applies to the whole checkout — that is what "in one go" means, and
 * a per-item project picker would just be the existing one-order-at-a-time flow
 * with extra steps. Parameters stay per item, as one card each.
 *
 * Parameter definitions are fetched lazily per item, because they depend on the
 * product AND environment pair and only the cart knows which pairs are present.
 */
export function CartView({ initialItems, projects, costCenters, token, lang }: Props) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [projectId, setProjectId] = useState(projects.length === 1 ? String(projects[0].id) : '')
  const [values, setValues] = useState<Record<number, Record<string, string>>>(() =>
    Object.fromEntries(initialItems.map((i) => [i.id, i.parameters ?? {}])),
  )
  const [defs, setDefs] = useState<Record<number, Parameter[]>>({})
  const [costCentres, setCostCentres] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState<CheckoutResponse['failed']>([])

  // One fetch per item, on first render of that item's card. Failures degrade to an
  // unlabelled card rather than blocking checkout — the server validates anyway.
  const loadDefs = async (item: CartItem) => {
    if (defs[item.id]) return
    try {
      const detail = await get<ProductDetail>(
        `/api/catalog/${item.productId}?lang=${lang}&environmentId=${item.environmentId}`,
        token,
      )
      if (detail?.parameters) setDefs((prev) => ({ ...prev, [item.id]: detail.parameters }))
    } catch {
      setDefs((prev) => ({ ...prev, [item.id]: [] }))
    }
  }

  async function handleRemove(itemId: number) {
    setError(null)
    try {
      await del(`/api/cart/${itemId}`, token)
      setItems((prev) => prev.filter((i) => i.id !== itemId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove the item.')
    }
  }

  async function handleClear() {
    setError(null)
    try {
      await del('/api/cart', token)
      setItems([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to empty the cart.')
    }
  }

  async function handleCheckout() {
    setBusy(true)
    setError(null)
    setPartial([])
    try {
      const body: CheckoutRequest = {
        projectId: Number(projectId),
        items: items.map((item) => ({
          cartItemId: item.id,
          parameters: withDefaults(item, defs[item.id] ?? [], values[item.id] ?? {}),
          ...(costCentres[item.id] ? { costCenterId: Number(costCentres[item.id]) } : {}),
        })),
      }
      const result = await post<CheckoutResponse>('/api/cart/checkout', body, token)

      if (result.failed.length > 0) {
        // Some orders exist and their pipelines may already be running, so this is
        // not an error to retry wholesale — say which items are still in the cart.
        setPartial(result.failed)
        setItems((prev) => prev.filter((i) => result.failed.some((f) => f.cartItemId === i.id)))
        return
      }
      router.push('/orders')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed.')
    } finally {
      setBusy(false)
    }
  }

  const unavailable = items.filter((i) => !i.stillOffered)
  const canCheckout = items.length > 0 && projectId !== '' && unavailable.length === 0 && !busy

  if (items.length === 0 && partial.length === 0) {
    return <p className="text-sm text-slate-600">{t('emptyCart', lang)}</p>
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {partial.length > 0 && (
        <Alert>
          <p className="font-medium">{t('someItemsFailed', lang)}</p>
          <ul className="mt-1 list-disc list-inside text-sm">
            {partial.map((f) => (
              <li key={f.cartItemId}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card>
        <div className="space-y-2">
          <Select
            label={t('project', lang)}
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            options={[{ value: '', label: t('selectProject', lang) }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <p className="text-xs text-slate-500">{t('cartCheckoutHint', lang)}</p>
        </div>
      </Card>

      {items.map((item) => (
        <CartItemCard
          key={item.id}
          item={item}
          defs={defs[item.id]}
          values={values[item.id] ?? {}}
          costCenterId={costCentres[item.id] ?? ''}
          costCenters={costCenters}
          lang={lang}
          onMount={() => loadDefs(item)}
          onValues={(next) => setValues((prev) => ({ ...prev, [item.id]: next }))}
          onCostCenter={(id) => setCostCentres((prev) => ({ ...prev, [item.id]: id }))}
          onRemove={() => handleRemove(item.id)}
        />
      ))}

      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button variant="secondary" onClick={handleClear} disabled={busy}>
            {t('clearCart', lang)}
          </Button>
          <Button onClick={handleCheckout} disabled={!canCheckout}>
            {busy ? t('checkingOut', lang) : `${t('checkout', lang)} (${items.length})`}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Merge each definition's default in for parameters the user did not touch.
 *
 * Mirrors OrderForm: the field's placeholder shows the default, so users expect it
 * to be submitted.
 */
const withDefaults = (
  item: CartItem,
  defs: Parameter[],
  edited: Record<string, string>,
): Record<string, string> => {
  if (defs.length === 0) return edited
  const merged: Record<string, string> = {}
  for (const def of defs) {
    if (def.environmentId !== null && def.environmentId !== item.environmentId) continue
    merged[def.name] = edited[def.name] ?? def.defaultValue ?? ''
  }
  return merged
}

function CartItemCard({
  item,
  defs,
  values,
  costCenterId,
  costCenters,
  lang,
  onMount,
  onValues,
  onCostCenter,
  onRemove,
}: {
  item: CartItem
  defs: Parameter[] | undefined
  values: Record<string, string>
  costCenterId: string
  costCenters: CostCenter[]
  lang: string
  onMount: () => void
  onValues: (next: Record<string, string>) => void
  onCostCenter: (id: string) => void
  onRemove: () => void
}) {
  // In an effect, not the render body: onMount performs a fetch, and a side effect
  // during render runs twice under StrictMode and blocks the paint.
  useEffect(() => {
    onMount()
    // Deliberately once per card. onMount already no-ops when the definitions are
    // loaded, and depending on it would refetch on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applicable = (defs ?? []).filter(
    (d) => d.environmentId === null || d.environmentId === item.environmentId,
  )

  return (
    <Card>
      <div data-testid={`cart-item-${item.id}`} className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-medium text-slate-900">
              {item.productName ?? `Product #${item.productId}`}
            </p>
            <p className="text-xs text-slate-500">
              {item.environmentName ?? `Environment #${item.environmentId}`}
              {item.price !== null && ` · ${item.price} ${item.currency}`}
            </p>
          </div>
          <Button size="sm" variant="danger" onClick={onRemove}>{t('remove', lang)}</Button>
        </div>

        {!item.stillOffered && <Alert>{t('itemUnavailable', lang)}</Alert>}

        {applicable.length > 0 && (
          <ParameterFields parameters={applicable} values={values} onChange={onValues} />
        )}

        {/* Per item, because the cost-centre rules live on the offering and two
            items in one cart can have different ones. */}
        <Select
          label={t('costCenter', lang)}
          value={costCenterId}
          onChange={(e) => onCostCenter(e.target.value)}
          options={[
            { value: '', label: t('selectCostCenter', lang) },
            ...costCenters.filter((cc) => cc.active).map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.name}` })),
          ]}
        />
      </div>
    </Card>
  )
}
