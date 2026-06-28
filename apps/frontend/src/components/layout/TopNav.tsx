'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'

interface TopNavProps {
  role: Role
  lang?: string
}

function navLinkClass(current: string, href: string, exact = false): string {
  const active = exact ? current === href : (current === href || (href !== '/' && current.startsWith(href)))
  const base = 'px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap '
  return active
    ? base + 'bg-white/15 text-white'
    : base + 'text-white/75 hover:text-white hover:bg-white/10'
}

export function TopNav({ role }: TopNavProps) {
  const pathname = usePathname()

  return (
    <div className="border-t border-white/10" style={{ backgroundColor: 'var(--bp)' }}>
      <nav className="max-w-screen-2xl mx-auto px-4 py-1 flex items-center gap-0.5 overflow-x-auto">
        <Link href="/" className={navLinkClass(pathname, '/', true)}>Home</Link>
        <Link href="/catalog" className={navLinkClass(pathname, '/catalog')}>Catalog</Link>
        <Link href="/orders" className={navLinkClass(pathname, '/orders')}>Orders</Link>
        <Link href="/projects" className={navLinkClass(pathname, '/projects')}>Projects</Link>
        <Link href="/infrastructure" className={navLinkClass(pathname, '/infrastructure')}>Infrastructure</Link>
        {(role === 'admin' || role === 'root') && (
          <>
            <Link href="/approvals" className={navLinkClass(pathname, '/approvals')}>Approvals</Link>
            <Link href="/audit" className={navLinkClass(pathname, '/audit')}>Audit</Link>
          </>
        )}
        {role === 'root' && (
          <Link href="/admin" className={navLinkClass(pathname, '/admin')}>Admin</Link>
        )}
      </nav>
    </div>
  )
}
