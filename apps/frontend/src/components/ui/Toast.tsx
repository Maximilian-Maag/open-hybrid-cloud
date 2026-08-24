'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { useLang } from '@/lib/useLang'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

let nextId = 1

/**
 * How long a toast stays up while nobody is looking at it.
 *
 * The countdown lives in the bubble, not here, because only the bubble knows
 * whether the pointer or the keyboard is on it — see the note there. A provider
 * -owned `setTimeout` cannot be paused, which is what made this a WCAG 2.2.1
 * failure rather than a short-timer complaint.
 */
const TOAST_MS = 3500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {/* BEFORE {children}, which looks wrong and is not: the container is
          `fixed`, so DOM order costs nothing visually and buys the one thing
          that mattered. It used to render after the whole app, so the dismiss
          button — correct in itself, 44px and labelled — sat behind every
          control on the page in tab order. On /admin/users that is well over
          3.5 s of tabbing, so it could not be operated before the thing it
          dismisses was gone (2.2.1).
          The live region is on each bubble (role="alert"/"status"), not here —
          an aria-live container wrapping children that declare their own live
          role nests two regions, and some screen readers then announce twice. */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastBubble key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
      {children}
    </ToastContext.Provider>
  )
}

const typeClass: Record<ToastType, string> = {
  success: 'bg-green-600',
  error:   'bg-red-600',
  info:    'bg-slate-700',
}

const typeIconPath: Record<ToastType, string> = {
  success: 'M5 13l4 4L19 7',
  error:   'M6 18L18 6M6 6l12 12',
  info:    'M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z',
}

function ToastBubble({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const lang = useLang()
  // Paused while the pointer is over the bubble or the keyboard is inside it.
  // That is the 2.2.1 "extend" exception done as a simple action: a user who is
  // reading the message, or who has tabbed to the dismiss button, is not racing
  // a timer any more.
  const [paused, setPaused] = useState(false)
  // What is left of the 3.5 s, so pausing and resuming does not restart it —
  // hovering a toast repeatedly must not keep it up forever, and must not throw
  // away the time already spent either.
  const remaining = useRef(TOAST_MS)
  // The provider passes a fresh arrow every render, so the effect below would
  // re-run — and re-read `remaining` — on every parent render if it depended on
  // the prop directly.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => dismissRef.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused])

  return (
    <div
      role={item.type === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      // React's onFocus/onBlur are focusin/focusout, so they fire for the
      // dismiss button inside as well as for the container.
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-xl text-sm font-medium text-white pointer-events-auto animate-toast-in min-w-56 max-w-xs ${typeClass[item.type]}`}
    >
      <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={typeIconPath[item.type]} />
      </svg>
      <span className="flex-1">{item.message}</span>
      <button
        onClick={onDismiss}
        // 44px (WCAG 2.5.5) inside a toast whose text line is 20px tall, so the
        // negative margin lets the target reach into the container's py-3 instead
        // of adding 24px of height to every toast. It still fits: 44px of button
        // in a 52px box.
        className="flex h-11 w-11 -my-2 shrink-0 items-center justify-center opacity-80 hover:opacity-100 transition-opacity rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label={t('dismiss', lang)}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
