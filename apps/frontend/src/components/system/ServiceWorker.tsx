'use client'

import { useEffect } from 'react'
import { registerServiceWorker } from '@/lib/serviceWorker'

/**
 * Registers the service worker once the app has mounted (#148).
 *
 * In an effect rather than at module scope so it never runs during SSR, and
 * after paint so it never competes with the first render for the network — the
 * worker's only job is the NEXT visit.
 */
export function ServiceWorker() {
  useEffect(() => registerServiceWorker(), [])
  return null
}
