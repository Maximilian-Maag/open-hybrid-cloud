'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const lang = useLang()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('somethingWentWrong', lang)}</h2>
        <p className="text-sm text-slate-500 max-w-md">{error.message}</p>
      </div>
      <Button onClick={reset} variant="secondary">
        {t('tryAgain', lang)}
      </Button>
    </div>
  )
}
