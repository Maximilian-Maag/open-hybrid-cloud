'use client'

import { useState } from 'react'
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
}

export function InfraActions({ item, token, lang = 'en' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (item.status !== 'active') return null

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

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        {t('decommission', lang)}
      </Button>
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
    </>
  )
}
