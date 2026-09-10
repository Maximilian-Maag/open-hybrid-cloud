import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
  className?: string
  action?: ReactNode
  /**
   * The heading level of the title.
   *
   * Defaults to 2 because the page's own `<h1>` is the only heading above a
   * card on every screen that uses one. It was a fixed `<h3>`, which meant
   * every page built from `PageHeader` + `Card` went h1 → h3 and skipped a
   * level — the thing `heading-order` exists to catch, and a rule this gate
   * never asked for until #185.
   *
   * A prop rather than a hardcoded `<h2>` because a card nested inside a
   * section that already has its own `<h2>` needs to go one deeper, and the
   * caller is the only one that knows.
   */
  level?: 2 | 3 | 4
}

export function Card({ title, children, className = '', action, level = 2 }: CardProps) {
  const Heading = `h${level}` as const

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          {/* The size is deliberately not tied to `level`: the visual weight of a
              card title is the same wherever it sits in the outline. */}
          <Heading className="text-base font-semibold text-slate-900">{title}</Heading>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="px-6 py-4">{children}</div>
    </div>
  )
}
