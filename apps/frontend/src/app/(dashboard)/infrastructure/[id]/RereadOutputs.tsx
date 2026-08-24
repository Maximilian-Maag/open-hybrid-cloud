'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

/**
 * Ask the server to read this element's Terraform outputs again (#218).
 *
 * Outputs are parsed once, when the order settles. If anything was wrong at that
 * instant — a revoked CI token, a log the parser could not read — the element is
 * blank forever, and the only remedies were a database script or redeploying real
 * infrastructure to get a second chance at a log that had not changed.
 *
 * So: a button. It re-fetches the pipeline log and stores what it parses. It
 * starts nothing and changes no infrastructure, which is why it sits next to the
 * outputs rather than among the destructive actions above.
 */
export function RereadOutputs({ elementId, token }: { elementId: number; token: string }) {
  const router = useRouter()
  const lang = useLang()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    try {
      await post(`/api/infrastructure/${elementId}/outputs`, {}, token)
      // The server has stored whatever it read; re-render from it rather than
      // trusting the response, so the page and the database cannot disagree.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedError', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <Button size="sm" variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void handleClick()}>
        {busy ? t('rereadingOutputs', lang) : t('rereadOutputs', lang)}
      </Button>
    </div>
  )
}
