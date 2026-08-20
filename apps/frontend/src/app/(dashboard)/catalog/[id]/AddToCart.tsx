'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProductDetail, AddToCartRequest, CartItem } from '@open-hybrid-cloud/types'
import { post, get } from '@/lib/api'
import { publishCartCount } from '@/components/layout/CartLink'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Select } from '@/components/ui/Select'
import { t } from '@/lib/i18n'

interface Props {
  product: ProductDetail
  token: string
  lang: string
}

/**
 * "Add to cart" in the buy box (issue #28).
 *
 * Asks only for the environment. Parameters are left for checkout — the whole point
 * of a cart is to collect first and fill in once, so demanding them here would make
 * adding to the cart as much work as ordering outright.
 */
export function AddToCart({ product, token, lang }: Props) {
  const router = useRouter()
  const [environmentId, setEnvironmentId] = useState(
    product.environments.length === 1 ? String(product.environments[0].environmentId) : '',
  )
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (product.environments.length === 0) return null

  async function handleAdd() {
    setBusy(true)
    setError(null)
    try {
      const body: AddToCartRequest = {
        productId: product.id,
        environmentId: Number(environmentId),
      }
      await post('/api/cart', body, token)
      setAdded(true)
      // Tell the header badge straight away — a shopper's confirmation that the
      // click landed is the count going up, and waiting for the server round trip
      // of router.refresh() to repaint the shell reads as a dead button.
      try {
        const items = await get<CartItem[]>('/api/cart', token)
        publishCartCount((items ?? []).length)
      } catch { /* the refresh below still corrects the badge */ }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add to the cart.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {added && <Alert tone="success">{t('addedToCart', lang)}</Alert>}
      <Select
        label={t('environment', lang)}
        value={environmentId}
        onChange={(e) => { setEnvironmentId(e.target.value); setAdded(false) }}
        options={[
          { value: '', label: t('selectEnvironment', lang) },
          ...product.environments.map((env) => ({
            value: env.environmentId,
            label: env.environmentName ?? `Env ${env.environmentId}`,
          })),
        ]}
      />
      {/* Plain primary: the branding's secondary colour is the app's CTA colour, and
          Button now draws it with a --bs-edge boundary so even a near-white one is a
          visible control. The radius comes from style, not a class: two competing
          rounded-* utilities resolve by stylesheet order, not source order. */}
      <Button
        onClick={handleAdd}
        disabled={busy || !environmentId}
        className="w-full"
        style={{ borderRadius: '9999px' }}
      >
        {t('addToCart', lang)}
      </Button>
    </div>
  )
}
