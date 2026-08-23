'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Order } from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TrialBadge } from '@/components/ui/TrialBadge'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface Props {
  order: Order
  token: string
  /**
   * The viewer. Needed because nobody approves their own order (issue #35) —
   * the backend refuses it, and hiding the button is how the viewer finds that
   * out before clicking rather than after.
   */
  currentUserId: number
}

export function ApprovalRow({ order, token, currentUserId }: Props) {
  const router = useRouter()
  const lang = useLang()
  const [rejecting, setRejecting] = useState(false)
  const [rejectionNote, setRejectionNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      // /api/approvals, not /api/orders: the approve and reject endpoints live
      // under the approvals resource, and this pointed at a path the backend has
      // never served.
      await post(`/api/approvals/${order.id}/approve`, {}, token)
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToApprove', lang))
    } finally {
      setLoading(false)
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await post(`/api/approvals/${order.id}/reject`, { rejectionNote }, token)
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToReject', lang))
    } finally {
      setLoading(false)
    }
  }

  if (done) return null

  const ownOrder = order.userId === currentUserId

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono text-xs text-slate-600">#{order.id}</span>
            <span className="font-semibold text-slate-900">
              {order.productName ?? `Product #${order.productId}`}
            </span>
            <StatusBadge status={order.status} lang={lang} />
            {order.isTrial && <TrialBadge lang={lang} />}
          </div>
          <p className="text-sm text-slate-500">
            {order.environmentName}
            {/* Size and quantity change what the approver is agreeing to: one
                decision covers all N elements (issues #98/#104), so "20 × XL" must
                not be something they have to open the order to discover. */}
            {order.sizeCode && <> · {t('size', lang)}: {order.sizeCode}</>}
            {order.quantity !== undefined && order.quantity > 1 && (
              <> · {t('quantity', lang)}: {order.quantity}</>
            )}
            {' · '}{order.projectName} · {t('orderedBy', lang)} {order.userName ?? `User #${order.userId}`} on{' '}
            {new Date(order.createdAt).toLocaleDateString(lang)}
          </p>
        </div>

        {!rejecting && (
          <div className="flex items-center gap-2 shrink-0">
            {ownOrder ? (
              <span className="text-sm text-slate-500">{t('cannotApproveOwnOrder', lang)}</span>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={handleApprove}
                disabled={loading}
              >
                {t('approve', lang)}
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              onClick={() => setRejecting(true)}
              disabled={loading}
            >
              {t('reject', lang)}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Alert className="mt-3">
          {error}
        </Alert>
      )}

      {rejecting && (
        <form onSubmit={handleReject} className="mt-4 space-y-3">
          <div className="flex flex-col gap-1">
            {/* Per-order id: the approvals list renders one of these per row. */}
            <label htmlFor={`rejection-note-${order.id}`} className="text-sm font-medium text-slate-700">{t('rejectionNote', lang)}</label>
            <textarea
              id={`rejection-note-${order.id}`}
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              rows={2}
              required
              placeholder={t('rejectionNotePlaceholder', lang)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={loading}>
              {loading ? t('rejecting', lang) : t('confirmRejection', lang)}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { setRejecting(false); setRejectionNote('') }}
              disabled={loading}
            >
              {t('cancel', lang)}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
