import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    // Stacked below `sm`, side by side from there. 24 pages render this and 9 of
    // them pass `actions`; with a single non-wrapping row, /infrastructure's
    // export cluster started at x=187 and ran to 427 on a 375px screen, so both
    // Export buttons were off it (#168). `min-w-0` lets a long title wrap instead
    // of setting the row's floor.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}
