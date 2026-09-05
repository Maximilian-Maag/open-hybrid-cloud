'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@open-hybrid-cloud/types'
import { del, put } from '@/lib/api'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface Props {
  /** Carries `retiredAt`, which is what the toggle below reads and writes. */
  product: Product
}

export function ProductRowActions({ product }: Props) {
  const lang = useLang()
  const router = useRouter()
  const { toast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const retired = product.retiredAt !== null

  /*
   * Disable and re-enable, the control #251 asked for.
   *
   * `retiredAt` already meant "not in the catalogue"; it was a side effect of
   * Delete refusing to destroy order history, it was one-way, and the admin
   * screens hid what it marked. So a root administrator who pressed Delete on a
   * product that had ever been ordered got it withdrawn, removed from every
   * list, and no way back short of a database update.
   */
  async function toggleRetired() {
    setToggling(true)
    setError(null)
    try {
      await put(`/api/admin/products/${product.id}/retired`, { retired: !retired })
      toast(
        `${t('product', lang)} “${product.name}” ${retired ? t('enabledToast', lang) : t('disabledToast', lang)}.`,
        'info',
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericFailed', lang))
    } finally {
      setToggling(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await del(`/api/admin/products/${product.id}`)
      setConfirmOpen(false)
      toast(`${t('product', lang)} “${product.name}” ${t('deleted', lang)}.`, 'info')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failedToDeleteProduct', lang))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex gap-2 justify-end">
      {/* Same-named links to different products (WCAG 2.4.9): the row says which
          product, the link did not, and a screen reader's link list is just
          "Edit, Edit, Edit". */}
      <ButtonLink href={`/admin/products/${product.id}`} size="sm" variant="secondary">
        {t('edit', lang)}<span className="sr-only"> {product.name}</span>
      </ButtonLink>
      {/* The name is in the button for the same reason it is in Edit: a screen
          reader's list of controls is otherwise "Disable, Disable, Disable". */}
      <Button size="sm" variant="secondary" onClick={() => void toggleRetired()} disabled={toggling}>
        {retired ? t('enable', lang) : t('disable', lang)}
        <span className="sr-only"> {product.name}</span>
      </Button>
      <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
        {t('delete', lang)}<span className="sr-only"> {product.name}</span>
      </Button>
      {error && <Alert className="w-full">{error}</Alert>}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('deleteProductPrompt', lang)} size="sm">
        <p className="text-sm text-slate-700 mb-3">
          {t('deleteProductPrompt', lang)} <strong>{product.name}</strong>? {t('cannotBeUndone', lang)}
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          {t('any', lang)} <strong>{t('productDeleteWarningActive', lang)}</strong> {t('productDeleteWarningBody', lang)}{' '}
          {t('productDeleteWarningCascade', lang)}
        </p>
        {error && (
          <Alert className="mb-4">{error}</Alert>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>{t('cancel', lang)}</Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? t('deleting', lang) : t('delete', lang)}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
