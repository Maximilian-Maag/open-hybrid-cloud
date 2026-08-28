/**
 * The placeholders a client-rendered page shows while its first fetch is in
 * flight.
 *
 * ── Decoration, and marked as such ───────────────────────────────────────────
 * A page renders four to eight of these in a loop, so each one announcing
 * itself would be four to eight announcements of nothing. They are
 * `aria-hidden` for that reason, and the ONE announcement belongs to the region
 * around them — see `LoadingRegion` below, which is what the callers use.
 *
 * ── `data-loading` is for the accessibility gate ─────────────────────────────
 * `e2e/a11y.spec.ts` scans right after `goto`, which resolves before hydration
 * has fired the fetch — so on every client-rendered page it was scanning THESE
 * rather than the page (#155). A skeleton has no form controls, no headings and
 * no text to fail contrast on, so the gate reported clean and meant nothing.
 *
 * The attribute is what the gate blocks on. Deliberately NOT the `animate-pulse`
 * class: `StatusBadge` pulses a dot for an in-progress element, so a gate that
 * waited on the class would hang on every page showing a provisioning order —
 * a page that is fully rendered and has nothing left to wait for. And not the
 * role either, which the region owns rather than the placeholder.
 */

/** Marks a node as a loading placeholder: invisible to AT, visible to the gate. */
const placeholder = { 'data-loading': '', 'aria-hidden': true } as const

export function SkeletonCard() {
  return (
    <div {...placeholder} className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col animate-pulse">
      <div className="h-40 bg-slate-100" />
      <div className="p-3 space-y-2">
        <div className="h-2 bg-slate-200 rounded w-1/3" />
        <div className="h-3 bg-slate-200 rounded w-4/5" />
        <div className="h-2 bg-slate-100 rounded w-2/3" />
        <div className="h-8 bg-slate-100 rounded mt-3" />
      </div>
    </div>
  )
}

export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr {...placeholder} className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-slate-200 rounded w-3/4" />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonListItem() {
  return (
    <div {...placeholder} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-slate-200" />
        <div className="space-y-1.5">
          <div className="h-3 bg-slate-200 rounded w-32" />
          <div className="h-2 bg-slate-100 rounded w-24" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="h-7 w-14 bg-slate-100 rounded-md" />
        <div className="h-7 w-14 bg-slate-100 rounded-md" />
      </div>
    </div>
  )
}

/**
 * The one thing that speaks while a page loads.
 *
 * `role="status"` with `aria-live="polite"` announces the wait once, without
 * interrupting whatever the user was reading; `aria-busy` marks the region as
 * not yet settled. Before this a client-rendered page was simply silent —
 * the pulse animation is the only thing that ever said "loading", and it says
 * it exclusively to people who can see it (WCAG 4.1.3).
 *
 * The label is visually hidden rather than absent: the placeholders already
 * carry the visual message, and a second one in text would be duplication for
 * everyone who can see them.
 */
export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
