'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

/**
 * Re-fetch a server-rendered page's data without a full reload.
 *
 * For the pages whose contents change without the user doing anything:
 * deployment status arrives from CI through a webhook, minutes after the order
 * was placed, and until now the only way to see it was to reload — or to notice
 * that nothing had changed and reload anyway. The status was never stale in the
 * database; the page was just a snapshot of the moment it rendered.
 *
 * `router.refresh()` re-runs the server component and reconciles the result, so
 * it keeps client state and scroll position — a browser reload throws both away
 * and, on the infrastructure list, closes every disclosure the user had opened.
 *
 * Wrapped in `useTransition` because `router.refresh()` returns void: the
 * transition is what knows when the server round trip is finished, and without it
 * the button has no honest pending state. A control that reads as instant when it
 * is not is how people end up pressing it four times.
 *
 * Deliberately NOT polling. A page that refreshes itself is a different feature
 * with different costs — every open tab becomes load whether anyone is looking at
 * it — and nobody asked for that.
 */
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter()
  const lang = useLang()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      // Disabled while in flight so a second press cannot queue another
      // round trip behind the first.
      disabled={pending}
      // The label already changes, but that is a visual cue; `aria-busy` is what
      // says "working" to a screen reader without it having to notice the text.
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? t('refreshing', lang) : t('refresh', lang)}
    </Button>
  )
}
