import type { ReactNode } from 'react'

/**
 * `level` is the heading rank of `title`, not its size.
 *
 * It defaults to 2 because a Card almost always sits directly under a
 * `PageHeader`, which renders the page's `<h1>`. It used to be a fixed `<h3>`,
 * which made every one of the 24 `PageHeader` pages read h1 → h3 — a skipped
 * level, and invisible to the gate until `best-practice` (and with it
 * `heading-order`) was requested. Pass a deeper level where a Card genuinely
 * nests under a section heading of its own.
 *
 * The paint does not change with the level: these titles are all the same size
 * by design, and tying rank to type scale is what produces heading soup.
 */
type Level = 2 | 3 | 4 | 5 | 6

interface CardProps {
  title?: string
  children: ReactNode
  className?: string
  action?: ReactNode
  level?: Level
}

export function Card({ title, children, className = '', action, level = 2 }: CardProps) {
  const Heading = `h${level}` as const
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <Heading className="text-base font-semibold text-slate-900">{title}</Heading>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="px-6 py-4">{children}</div>
    </div>
  )
}
