'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProductDetail, AddToCartRequest } from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
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
 * "Add to cart" alongside the existing order form (issue #28).
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
      // Refresh so the cart badge in the navigation picks the new item up.
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
      <div className="flex items-end gap-3 flex-wrap">
        <Select
          label={t('environment', lang)}
          value={environmentId}
          onChange={(e) => { setEnvironmentId(e.target.value); setAdded(false) }}
          className="min-w-56"
          options={[
            { value: '', label: t('selectEnvironment', lang) },
            ...product.environments.map((env) => ({
              value: env.environmentId,
              label: env.environmentName ?? `Env ${env.environmentId}`,
            })),
          ]}
        />
        <Button variant="secondary" onClick={handleAdd} disabled={busy || !environmentId}>
          {t('addToCart', lang)}
        </Button>
      </div>
    </div>
  )
}
