'use client'

import { Button } from '@/components/ui/Button'

/**
 * Reload, rather than a link back.
 *
 * A `<Link href="/">` would be handled by the router, which has nothing to
 * route to while the network is down — the click would appear to do nothing. A
 * full reload asks the network again, which is the question the person is
 * actually asking.
 */
export function OfflineRetry({ label }: { label: string }) {
  return (
    <Button onClick={() => window.location.reload()} className="min-h-11">
      {label}
    </Button>
  )
}
