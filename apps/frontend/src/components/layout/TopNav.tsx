'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface TopNavProps {
  role: Role
  lang?: string
}

function isActive(current: string, href: string, exact = false): boolean {
  return exact ? current === href : (current === href || (href !== '/' && current.startsWith(href)))
}

function navLinkClass(current: string, href: string, exact = false): string {
  const active = isActive(current, href, exact)
  // Colour comes from --bp-ink (derived from the branding colour) at FULL
  // opacity — readableInk's 4.5:1 guarantee is measured at full opacity, so
  // dimming the resting state would give it back. The active item is
  // distinguished by background and weight, plus aria-current. The active item is additionally
  // marked with aria-current so it is not signalled by colour alone.
  // inline-flex + min-h-11 makes each pill a 44px WCAG 2.5.5 target. This is the
  // one place in the app where that costs visible layout — the nav strip grows
  // from 36px to 52px — and it is worth it: these links are how the whole
  // portal is navigated, and a 28px pill was the hardest thing here to hit.
  const base = 'inline-flex items-center min-h-11 px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap '
  return active
    ? base + 'brand-state-active font-semibold'
    : base + 'brand-state'
}

export function TopNav({ role, lang: initialLang = 'en' }: TopNavProps) {
  const pathname = usePathname()
  const lang = useLang(initialLang)

  return (
    <div className="border-t border-current/10" style={{ backgroundColor: 'var(--bp)' }}>
      <nav aria-label={t('mainNavigation', lang)} className="max-w-screen-2xl mx-auto px-4 py-1 flex items-center gap-0.5 overflow-x-auto" style={{ color: 'var(--bp-ink)' }}>
        <Link href="/" aria-current={isActive(pathname, '/', true) ? 'page' : undefined} className={navLinkClass(pathname, '/', true)}>{t('home', lang)}</Link>
        <Link href="/catalog" aria-current={isActive(pathname, '/catalog') ? 'page' : undefined} className={navLinkClass(pathname, '/catalog')}>{t('catalog', lang)}</Link>
        <Link href="/orders" aria-current={isActive(pathname, '/orders') ? 'page' : undefined} className={navLinkClass(pathname, '/orders')}>{t('orders', lang)}</Link>
        <Link href="/projects" aria-current={isActive(pathname, '/projects') ? 'page' : undefined} className={navLinkClass(pathname, '/projects')}>{t('projects', lang)}</Link>
        <Link href="/infrastructure" aria-current={isActive(pathname, '/infrastructure') ? 'page' : undefined} className={navLinkClass(pathname, '/infrastructure')}>{t('infrastructure', lang)}</Link>
        <Link href="/costs" aria-current={isActive(pathname, '/costs') ? 'page' : undefined} className={navLinkClass(pathname, '/costs')}>{t('costs', lang)}</Link>
        {(role === 'admin' || role === 'root') && (
          <>
            <Link href="/approvals" aria-current={isActive(pathname, '/approvals') ? 'page' : undefined} className={navLinkClass(pathname, '/approvals')}>{t('approvals', lang)}</Link>
            <Link href="/audit" aria-current={isActive(pathname, '/audit') ? 'page' : undefined} className={navLinkClass(pathname, '/audit')}>{t('audit', lang)}</Link>
          </>
        )}
        {role === 'root' && (
          <Link href="/admin" aria-current={isActive(pathname, '/admin') ? 'page' : undefined} className={navLinkClass(pathname, '/admin')}>{t('admin', lang)}</Link>
        )}
      </nav>
    </div>
  )
}
