'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

/**
 * Root releases a scheduled order without waiting for its window (#330).
 *
 * Root rather than admin, and the distinction is the point: approving decides
 * that an order should happen, this decides it should happen outside the hours
 * the company said it watches its own systems — which is the guarantee the
 * feature exists to make. The server checks the role and the status again.
 *
 * No confirmation dialogue, unlike WriteOffOrder. That one asks for a typed
 * reason because it records a failure nobody observed; this is reversible in
 * the only sense that matters — the deployment simply happens now instead of at
 * 08:00 — and the audit entry names who did it either way. A modal in front of
 * a one-line decision is a modal people learn to dismiss.
 */
export function DeployNow({ orderId }: { orderId: number }) {
  const router = useRouter()
  const lang = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function deployNow() {
    setBusy(true)
    setError(null)
    try {
      await post(`/api/orders/${orderId}/deploy-now`, {})
      router.refresh()
    } catch (e) {
      // The server's own words: it is the only thing that knows the sweep got
      // there first, or that CI would not answer.
      setError(e instanceof Error ? e.message : t('deployNowFailed', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={deployNow} disabled={busy} title={t('deployNowHint', lang)}>
        {busy ? t('saving', lang) : t('deployNow', lang)}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  )
}
