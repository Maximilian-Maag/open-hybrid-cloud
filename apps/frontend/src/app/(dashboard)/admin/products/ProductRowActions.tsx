'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Product } from '@open-hybrid-cloud/types'
import { del } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'

interface Props {
  product: Product
  token: string
}

export function ProductRowActions({ product, token }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await del(`/api/admin/products/${product.id}`, token)
      setConfirmOpen(false)
      toast(`Product “${product.name}” deleted.`, 'info')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete product.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex gap-2 justify-end">
      <Link href={`/admin/products/${product.id}`}>
        <Button size="sm" variant="secondary">Edit</Button>
      </Link>
      <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>Delete</Button>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete product" size="sm">
        <p className="text-sm text-slate-700 mb-3">
          Delete product <strong>{product.name}</strong>? This cannot be undone.
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Any <strong>active</strong> infrastructure element provisioned from this product will be
          automatically decommissioned (the GitLab destroy webhook is triggered before the product is
          removed). Translations, parameters, and environment assignments are dropped via cascading deletes.
        </p>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
