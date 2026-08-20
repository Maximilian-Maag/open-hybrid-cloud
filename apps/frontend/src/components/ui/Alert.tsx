import type { ReactNode } from 'react'

type Tone = 'error' | 'success' | 'warning' | 'info'

interface AlertProps {
  tone?: Tone
  children: ReactNode
  className?: string
}

const toneClass: Record<Tone, string> = {
  error:   'bg-red-50 border-red-200 text-red-700',
  success: 'bg-green-50 border-green-200 text-green-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info:    'bg-blue-50 border-blue-200 text-blue-800',
}

/**
 * Inline status message for a form or a page section.
 *
 * The point of this component is the live-region wiring, not the styling. These
 * messages appear *after* the user submits something, so they are inserted into
 * an already-rendered page — a plain <div> is painted silently and a screen
 * reader user never learns the submit failed (WCAG 4.1.3 Status Messages).
 *
 * `error` and `warning` get role="alert" (implicitly assertive) because they
 * interrupt what the user was doing. `success` and `info` get role="status"
 * (polite) so a confirmation waits for a pause instead of cutting in.
 */
export function Alert({ tone = 'error', children, className = '' }: AlertProps) {
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${toneClass[tone]} ${className}`}
    >
      {children}
    </div>
  )
}
