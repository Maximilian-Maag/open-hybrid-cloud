'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Order } from '@open-hybrid-cloud/types'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'

interface Props {
  order: Order
  token: string
}

export function ApprovalRow({ order, token }: Props) {
  const router = useRouter()
  const [rejecting, setRejecting] = useState(false)
  const [rejectionNote, setRejectionNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      await post(`/api/orders/${order.id}/approve`, {}, token)
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await post(`/api/orders/${order.id}/reject`, { rejectionNote }, token)
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject.')
    } finally {
      setLoading(false)
    }
  }

  if (done) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono text-xs text-slate-400">#{order.id}</span>
            <span className="font-semibold text-slate-900">
              {order.productName ?? `Product #${order.productId}`}
            </span>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-slate-500">
            {order.environmentName} · {order.projectName} · Ordered by {order.userName ?? `User #${order.userId}`} on{' '}
            {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>

        {!rejecting && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="primary"
              onClick={handleApprove}
              disabled={loading}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setRejecting(true)}
              disabled={loading}
            >
              Reject
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {rejecting && (
        <form onSubmit={handleReject} className="mt-4 space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Rejection Note</label>
            <textarea
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              rows={2}
              required
              placeholder="Explain why this order is being rejected…"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={loading}>
              {loading ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { setRejecting(false); setRejectionNote('') }}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
