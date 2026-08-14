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
  // Colour comes from --bp-ink (derived from the branding colour), so these
  // stay legible whatever the operator picked. The active item is additionally
  // marked with aria-current so it is not signalled by colour alone.
  const base = 'px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap '
  return active
    ? base + 'bg-current/15 font-semibold'
    : base + 'opacity-80 hover:opacity-100 hover:bg-current/10'
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
