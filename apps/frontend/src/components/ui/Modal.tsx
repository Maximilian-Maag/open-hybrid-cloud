'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { useLang } from '@/lib/useLang'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  ariaLabel?: string
  /** Overrides the detected language for the close button's accessible name. */
  lang?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

/**
 * Every size is clamped to the viewport as well as to its nominal width.
 *
 * A <dialog> is laid out in the top layer, where `w-full` means the containing
 * block, not the screen — so none of these four used to fit a phone. The default
 * `md` measured 448px on a 375px viewport and rendered at x=111, shearing the
 * field labels off the left edge and running 184px past the right. That is 11
 * call sites, which is where most of this app's forms live (#167).
 *
 * `min()` rather than a second `max-w-*` utility: two max-width classes on one
 * element are decided by the order Tailwind emits them, not by the order they are
 * written in, so the clamp would be a coin flip.
 */
const sizeClass: Record<string, string> = {
  sm: 'max-w-[min(24rem,calc(100vw-2rem))]',
  md: 'max-w-[min(28rem,calc(100vw-2rem))]',
  lg: 'max-w-[min(32rem,calc(100vw-2rem))]',
  xl: 'max-w-[min(42rem,calc(100vw-2rem))]',
}

export function Modal({ open, onClose, title, ariaLabel, children, size = 'md', lang }: ModalProps) {
  // The close button's accessible name has to match the document language, and
  // Modal is already a client component — reading the language here keeps all 11
  // call sites from having to thread it through.
  const detected = useLang(lang ?? 'en')
  const closeLabel = t('close', lang ?? detected)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
    } else {
      if (dialog.open) dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handler = () => onClose()
    dialog.addEventListener('close', handler)
    return () => dialog.removeEventListener('close', handler)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      className={`w-full ${sizeClass[size]} mx-auto my-auto rounded-2xl shadow-2xl bg-white p-0 open:flex open:flex-col max-h-[90vh] animate-modal-in`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose()
      }}
    >
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 shrink-0">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            // -mr-2 buys the extra width back out of the header's px-6, so the
            // 44px target (WCAG 2.5.5) does not push the title inward: the ✕ stays
            // optically where it was, its clickable box just now reaches the
            // padding it always looked like it filled.
            className="flex h-11 w-11 -mr-2 shrink-0 items-center justify-center rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
            aria-label={closeLabel}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <div className="px-6 py-4 flex-1 overflow-y-auto">{children}</div>
    </dialog>
  )
}
