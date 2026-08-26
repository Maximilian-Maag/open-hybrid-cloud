'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { InfrastructureElement } from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { Modal } from '@/components/ui/Modal'
import { t } from '@/lib/i18n'

interface Props {
  item: InfrastructureElement
  lang?: string
  /** Retry re-fires CI pipelines, so it is offered to admin and root only. */
  canRetry?: boolean
}

export function InfraActions({ item, lang = 'en', canRetry = false }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryOpen, setRetryOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  // datetime-local wants `YYYY-MM-DDTHH:mm` in LOCAL time, while the API speaks
  // ISO-8601 with an offset. Convert in both directions rather than slicing the
  // ISO string, which would silently shift the value by the UTC offset.
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(item.scheduledDecommissionAt))

  // The element is 'active' whether or not provisioning succeeded — it is created
  // when provisioning starts — so the failure lives on the order.
  const deploymentFailed = item.orderStatus === 'failed'

  async function handleRetry() {
    setRetrying(true)
    setRetryError(null)
    try {
      await post(`/api/infrastructure/${item.id}/retry`, {})
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
      await post(`/api/infrastructure/${item.id}/decommission`, {})
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('orderError', lang))
    } finally {
      setLoading(false)
    }
  }

  async function handleSchedule(clear = false) {
    if (!clear && !scheduledAt) return
    setScheduleSaving(true)
    setScheduleError(null)
    try {
      await post(
        `/api/infrastructure/${item.id}/schedule-decommission`,
        { scheduledAt: clear ? null : new Date(scheduledAt).toISOString() },
      )
      if (clear) setScheduledAt('')
      setScheduleOpen(false)
      router.refresh()
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : t('orderError', lang))
    } finally {
      setScheduleSaving(false)
    }
  }

  // Reorder stays available for decommissioned elements too — reprovisioning
  // something that was torn down is exactly when the original parameters are
  // hardest to reconstruct by hand.
  const reorderHref =
    `/catalog/${item.productId}?fromInfra=${item.id}&projectId=${item.projectId}`

  return (
    <div className="flex items-center gap-2">
      {/* An <a> painted like a button, not an <a> wrapping one — see ButtonLink
          for why no gate catches that wrap. The classes were copied out of Button
          by hand here until ButtonLink existed. */}
      <ButtonLink href={reorderHref} variant="secondary" size="sm">
        {t('reorder', lang)}
        {/* Every row offers "Reorder" and every one of them points somewhere
            different, so a screen reader's link list reads "Reorder, Reorder,
            Reorder" (WCAG 2.4.9). The element id is the distinguisher, for the
            same reason it is on the row heading: two elements can be provisioned
            from the same product, so the product name alone is not unique. */}
        <span className="sr-only">
          {' '}{item.productName ?? `Product #${item.productId}`} #{item.id}
        </span>
      </ButtonLink>
      {canRetry && deploymentFailed && (
        <Button variant="secondary" size="sm" onClick={() => { setRetryError(null); setRetryOpen(true) }}>
          {t('retry', lang)}
        </Button>
      )}
      {item.status === 'active' && !deploymentFailed && (
        <Button variant="secondary" size="sm" onClick={() => { setScheduleError(null); setScheduleOpen(true) }}>
          {t('autoDecommission', lang)}
        </Button>
      )}
      {item.status === 'active' && !deploymentFailed && (
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          {t('decommission', lang)}
        </Button>
      )}

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title={t('scheduleDecommission', lang)} size="sm">
        <p className="text-sm text-slate-600 mb-4">{t('scheduleHint', lang)}</p>
        {scheduleError && <Alert className="mb-4">{scheduleError}</Alert>}
        <Input
          label={t('scheduledFor', lang)}
          type="datetime-local"
          value={scheduledAt}
          // Browsers only enforce `min` on the picker, not on typed input, and the
          // server validates anyway — this is a hint, not the guard.
          min={toLocalInput(new Date().toISOString())}
          hint={t('scheduleMustBeFuture', lang)}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" onClick={() => setScheduleOpen(false)}>{t('cancel', lang)}</Button>
          {item.scheduledDecommissionAt && (
            <Button variant="danger" disabled={scheduleSaving} onClick={() => handleSchedule(true)}>
              {t('clearSchedule', lang)}
            </Button>
          )}
          <Button disabled={scheduleSaving || !scheduledAt} onClick={() => handleSchedule(false)}>
            {scheduleSaving ? t('saving', lang) : t('confirm', lang)}
          </Button>
        </div>
      </Modal>

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

/**
 * ISO-8601 → the `YYYY-MM-DDTHH:mm` local-time format datetime-local requires.
 *
 * Slicing the ISO string instead would present a UTC instant as though it were
 * local, shifting the displayed time by the viewer's offset.
 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
