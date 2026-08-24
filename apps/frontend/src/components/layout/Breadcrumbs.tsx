import Link from 'next/link'

export interface Crumb {
  label: string
  /** Omitted on the last crumb: the page you are already on is not a link. */
  href?: string
}

interface Props {
  items: Crumb[]
  /** t('breadcrumb', lang) — the trail's own accessible name. */
  label: string
}

/**
 * The breadcrumb trail (WCAG 2.4.8 Location).
 *
 * Every detail page in this app is reached from a list, and until now only the
 * product page said so — with an ad-hoc `<nav>` whose accessible name was
 * "Catalog", which reads to a screen reader as a second navigation landmark
 * rather than "you are here". A "Back to Orders" button tells you where you can
 * go; it does not tell you where you are, and 2.4.8 is about the latter.
 *
 * Shape choices that are not cosmetic:
 *
 *  - An ordered list, because the trail is a sequence and a screen reader should
 *    announce "1 of 3".
 *  - `aria-current="page"` on the last crumb, which is the part that actually
 *    states the location. It is a plain <span>, not a disabled link.
 *  - The separator is `aria-hidden`, so the trail does not read as
 *    "Catalog chevron Databases chevron Postgres".
 *  - Links are underlined at rest. They sit inside a line of text painted in the
 *    branding colour, so colour alone would be the only thing distinguishing them
 *    (WCAG 1.4.1) — on the default palette the accent measures 1.03:1 against the
 *    surrounding slate.
 *
 * Not sized to 44px: see the 2.5.5 entry in docs/guides/accessibility.md. These
 * are content links in a line of text, and boxing each one would overlap its
 * neighbours across the separator.
 */
export function Breadcrumbs({ items, label }: Props) {
  return (
    <nav aria-label={label} className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-600">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-x-1.5">
              {/* slate-500, not slate-400. The chevron is aria-hidden, so it is
                  not text for 1.4.3 — but it is the only thing separating two
                  crumbs visually, so 1.4.11's 3:1 applies and slate-400 measured
                  2.51:1 on the slate-50 page background. slate-500 is 4.55.
                  axe cannot see this: `color-contrast` drops any element whose
                  visible text strips to nothing once punctuation is removed, and
                  a lone `›` does. */}
              {i > 0 && <span aria-hidden="true" className="text-slate-500">›</span>}
              {item.href && !last ? (
                <Link href={item.href} className="underline" style={{ color: 'var(--bp-text)' }}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="font-medium text-slate-700">
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
