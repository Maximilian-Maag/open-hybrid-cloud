'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ParameterFields } from '@/components/forms/ParameterFields'
import { publishCartCount } from '@/components/layout/CartLink'
import { t } from '@/lib/i18n'
import { convertPrice } from '@/lib/locale'
import { ProductImage } from '../catalog/[id]/ProductImage'

interface Props {
  initialItems: CartItem[]
  projects: Project[]
  costCenters: CostCenter[]
  token: string
  lang: string
  /** Rates relative to EUR, for the subtotal in the viewer's currency. */
  exchangeRates: Record<string, number>
  localeCurrency: string
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
export function CartView({
  initialItems,
  projects,
  costCenters,
  token,
  lang,
  exchangeRates,
  localeCurrency,
}: Props) {
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
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== itemId)
        publishCartCount(next.length)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove the item.')
    }
  }

  async function handleClear() {
    setError(null)
    try {
      await del('/api/cart', token)
      setItems([])
      publishCartCount(0)
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
        setItems((prev) => {
          const next = prev.filter((i) => result.failed.some((f) => f.cartItemId === i.id))
          publishCartCount(next.length)
          return next
        })
        return
      }
      publishCartCount(0)
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
  const totals = subtotal(items, exchangeRates, localeCurrency, lang)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* The cart itself */}
      <div className="lg:col-span-8 space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 sm:px-6">
          <h1 className="text-2xl font-bold text-slate-900">{t('cart', lang)}</h1>
          {items.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">{t('cartCheckoutHint', lang)}</p>
          )}

          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          {partial.length > 0 && (
            <div className="mt-4">
              <Alert>
                <p className="font-medium">{t('someItemsFailed', lang)}</p>
                <ul className="mt-1 list-disc list-inside text-sm">
                  {partial.map((f) => (
                    <li key={f.cartItemId}>{f.message}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}

          {items.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">{t('emptyCart', lang)}</p>
          ) : (
            <>
              <div className="mt-2 divide-y divide-slate-200">
                {items.map((item) => (
                  <CartItemRow
                    key={item.id}
                    item={item}
                    defs={defs[item.id]}
                    values={values[item.id] ?? {}}
                    costCenterId={costCentres[item.id] ?? ''}
                    costCenters={costCenters}
                    lang={lang}
                    price={itemPrice(item, exchangeRates, localeCurrency, lang)}
                    onMount={() => loadDefs(item)}
                    onValues={(next) => setValues((prev) => ({ ...prev, [item.id]: next }))}
                    onCostCenter={(id) => setCostCentres((prev) => ({ ...prev, [item.id]: id }))}
                    onRemove={() => handleRemove(item.id)}
                  />
                ))}
              </div>
              <div className="mt-4 flex justify-end border-t border-slate-200 pt-4">
                <Button variant="secondary" onClick={handleClear} disabled={busy}>
                  {t('clearCart', lang)}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Subtotal panel, where a shopper looks for the total and the way out */}
      {items.length > 0 && (
        <div className="lg:col-span-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-28 space-y-3">
            <p className="text-lg text-slate-900">
              {t('subtotal', lang)} ({items.length} {t('items', lang)}):{' '}
              <span className="font-bold">{totals.display}</span>
            </p>
            {totals.unconverted.length > 0 && (
              // Reported rather than folded in at par, which would quietly misstate
              // the total by whatever the missing rate happens to be.
              <p className="text-xs text-amber-700">
                {t('unconvertedNotice', lang)} {totals.unconverted.join(', ')}
              </p>
            )}

            <Select
              label={t('project', lang)}
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              options={[{ value: '', label: t('selectProject', lang) }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />

            <Button
              onClick={handleCheckout}
              disabled={!canCheckout}
              className="w-full"
              style={{ borderRadius: '9999px' }}
            >
              {busy ? t('checkingOut', lang) : `${t('checkout', lang)} (${items.length})`}
            </Button>
            {/* Why checkout is inert is said once, on the offending row — repeating
                it here would leave the reader looking for a second problem. */}
          </div>
        </div>
      )}
    </div>
  )
}

/** One item's price in the viewer's currency, or null when it has none stored. */
const itemPrice = (
  item: CartItem,
  rates: Record<string, number>,
  displayCurrency: string,
  lang: string,
): string | null => {
  if (item.price === null || item.currency === null) return null
  const converted = convertPrice(item.price, item.currency, displayCurrency, rates, lang)
  return `${converted.amount} ${converted.currency}`
}

/**
 * Subtotal across the cart.
 *
 * Rates are relative to EUR, so everything goes through EUR. An item in a currency
 * with no stored rate cannot be added to the total honestly, so it is reported
 * separately instead of being counted at par.
 */
const subtotal = (
  items: CartItem[],
  rates: Record<string, number>,
  displayCurrency: string,
  lang: string,
): { display: string; unconverted: string[] } => {
  const rateOf = (currency: string): number | null =>
    currency === 'EUR' ? 1 : (rates[currency] ?? null)

  const target = rateOf(displayCurrency)
  let eur = 0
  const unconverted = new Map<string, number>()

  for (const item of items) {
    if (item.price === null || item.currency === null) continue
    const amount = Number(item.price)
    if (!Number.isFinite(amount)) continue
    const source = rateOf(item.currency)
    if (source === null || target === null) {
      unconverted.set(item.currency, (unconverted.get(item.currency) ?? 0) + amount)
      continue
    }
    eur += amount / source
  }

  const converted = convertPrice(eur.toFixed(2), 'EUR', target === null ? 'EUR' : displayCurrency, rates, lang)
  return {
    display: `${converted.amount} ${converted.currency}`,
    unconverted: [...unconverted.entries()].map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`),
  }
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

function CartItemRow({
  item,
  defs,
  values,
  costCenterId,
  costCenters,
  lang,
  price,
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
  /** Already converted for display, or null when the offering stores no price. */
  price: string | null
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
    <div data-testid={`cart-item-${item.id}`} className="flex gap-4 py-4">
      {/* Thumbnail, so a cart of several items is scannable by sight. Deliberately
          not a second link to the product: the name beside it already is one, and
          an aria-hidden link that still takes focus is its own a11y problem. */}
      <div className="h-24 w-24 shrink-0 rounded border border-slate-200 p-1">
        <ProductImage productId={item.productId} name="" />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/catalog/${item.productId}`}
              className="text-base font-medium text-slate-900 hover:underline"
            >
              {item.productName ?? `Product #${item.productId}`}
            </Link>
            <p className="text-xs text-slate-500">
              {item.environmentName ?? `Environment #${item.environmentId}`}
            </p>
            {!item.stillOffered && (
              <p className="mt-1 text-xs font-medium text-red-600">{t('itemUnavailable', lang)}</p>
            )}
          </div>
          {price && <p className="whitespace-nowrap font-bold text-slate-900">{price}</p>}
        </div>

        {/* Padding zeroed through style, not a class: an important-prefixed
            utility competing with the base px-3 resolves by stylesheet order. */}
        <Button
          size="sm"
          variant="danger"
          onClick={onRemove}
          style={{ paddingLeft: 0, paddingRight: 0 }}
        >
          {t('remove', lang)}
        </Button>

        {/* Kept on the row rather than hidden behind a disclosure: unlike a retail
            cart, these are required to provision and checkout validates them. */}
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
    </div>
  )
}
