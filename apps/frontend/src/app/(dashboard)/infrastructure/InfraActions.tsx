'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { InfrastructureElement } from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Modal } from '@/components/ui/Modal'
import { t } from '@/lib/i18n'

interface Props {
  item: InfrastructureElement
  token: string
  lang?: string
  /** Retry re-fires CI pipelines, so it is offered to admin and root only. */
  canRetry?: boolean
}

export function InfraActions({ item, token, lang = 'en', canRetry = false }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryOpen, setRetryOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  // The element is 'active' whether or not provisioning succeeded — it is created
  // when provisioning starts — so the failure lives on the order.
  const deploymentFailed = item.orderStatus === 'failed'

  async function handleRetry() {
    setRetrying(true)
    setRetryError(null)
    try {
      await post(`/api/infrastructure/${item.id}/retry`, {}, token)
      setRetryOpen(false)
      router.refresh()
    } catch (err) {
      // Keep the dialog open: a partial retry comes back 502 with the list of
      // triggers that still need attention, which is the whole message.
      setRetryError(err instanceof Error ? err.message : t('orderError', lang))
    } finally {
      setRetrying(false)
    }
  }


  async function handleDecommission() {
    setLoading(true)
    setError(null)
    try {
      await post(`/api/infrastructure/${item.id}/decommission`, {}, token)
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('orderError', lang))
    } finally {
      setLoading(false)
    }
  }

  // Reorder stays available for decommissioned elements too — reprovisioning
  // something that was torn down is exactly when the original parameters are
  // hardest to reconstruct by hand.
  const reorderHref =
    `/catalog/${item.productId}?fromInfra=${item.id}&projectId=${item.projectId}`

  return (
    <div className="flex items-center gap-2">
      {/* Styled as a button rather than wrapping one: an <a> containing a
          <button> is nested-interactive, which the axe gate flags on this page. */}
      <Link
        href={reorderHref}
        className="inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white px-3 py-1.5 text-xs bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
      >
        {t('reorder', lang)}
      </Link>
      {canRetry && deploymentFailed && (
        <Button variant="secondary" size="sm" onClick={() => { setRetryError(null); setRetryOpen(true) }}>
          {t('retry', lang)}
        </Button>
      )}
      {item.status === 'active' && !deploymentFailed && (
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          {t('decommission', lang)}
        </Button>
      )}

      <Modal open={retryOpen} onClose={() => setRetryOpen(false)} title={t('retryDeployment', lang)} size="sm">
        <p className="text-sm text-slate-600 mb-4">
          {t('retryWarning', lang)}{' '}
          <strong>{item.productName ?? `element #${item.id}`}</strong>
        </p>
        {retryError && <Alert className="mb-4">{retryError}</Alert>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRetryOpen(false)}>{t('cancel', lang)}</Button>
          <Button onClick={handleRetry} disabled={retrying}>
            {retrying ? t('retrying', lang) : t('retry', lang)}
          </Button>
        </div>
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title={t('decommissionConfirm', lang)} size="sm">
        <p className="text-sm text-slate-600 mb-4">
          {t('decommissionWarning', lang)}{' '}
          <strong>{item.productName ?? `element #${item.id}`}</strong>?
          {' '}{t('cannotBeUndone', lang)}
        </p>
        {error && (
          <Alert className="mb-4">
            {error}
          </Alert>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel', lang)}</Button>
          <Button variant="danger" onClick={handleDecommission} disabled={loading}>
            {loading ? t('decommissioning', lang) : t('decommission', lang)}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
