'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Alert } from '@/components/ui/Alert'
import { Input } from '@/components/ui/Input'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

/**
 * Root's way out of an order whose pipeline never reported back (#206).
 *
 * An order enters `provisioning` when CI is triggered and leaves it when the
 * callback arrives. When the callback never arrives — the pipeline finished and
 * nothing posted the result, a token was wrong, a URL was — the order sits there
 * for ever, and every operator action is behind a status it will never reach:
 * Retry is offered only for `failed`, and decommissioning the element leaves the
 * order itself stuck. Seen live as order 37 on the dev instance: provisioning
 * since 24 August, `updated_at` 0.6 seconds after `created_at`.
 *
 * Shown only to root, and only on an order that is actually in `provisioning`.
 * The server checks both again, and refuses while the order could still be
 * running — the reason the reason field is mandatory is that this writes a
 * failure nobody observed, and the audit entry has to say who decided that.
 */
export function WriteOffOrder({ orderId }: { orderId: number }) {
  const router = useRouter()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    try {
      await post(`/api/orders/${orderId}/write-off`, { reason })
      setOpen(false)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedError', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => { setError(null); setOpen(true) }}>
        {t('writeOffOrder', lang)}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('writeOffOrderTitle', lang)} size="md">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <p className="text-sm text-slate-600">{t('writeOffOrderIntro', lang)}</p>
          <Input
            label={t('writeOffReason', lang)}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            hint={t('writeOffReasonHint', lang)}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel', lang)}</Button>
          <Button
            variant="danger"
            disabled={busy || reason.trim() === ''}
            aria-busy={busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? t('writingOffOrder', lang) : t('writeOffOrder', lang)}
          </Button>
        </div>
      </Modal>
    </>
  )
}
