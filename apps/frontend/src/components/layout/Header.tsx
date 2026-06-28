'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { LanguageSwitcher } from './LanguageSwitcher'

interface HeaderProps {
  userName?: string | null
  shopName?: string
  logoDataUrl?: string | null
  lang?: string
  signOutLabel?: string
}

export function Header({
  userName,
  shopName = 'Open Hybrid Cloud',
  logoDataUrl,
  lang = 'en',
  signOutLabel = 'Sign out',
}: HeaderProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/catalog?q=${encodeURIComponent(q)}` : '/catalog')
  }

  return (
    <header className="sticky top-0 z-50" style={{ backgroundColor: 'var(--bp)' }}>
      <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0 mr-2">
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUrl} alt={shopName} className="h-8 max-w-[120px] object-contain" />
          ) : (
            <span className="text-white font-bold text-lg tracking-tight whitespace-nowrap">{shopName}</span>
          )}
        </Link>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-xl">
          <div className="flex items-center bg-white rounded-md overflow-hidden">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lang === 'de' ? 'Produkte suchen…' : 'Search products…'}
              className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Search"
              className="px-4 py-2 text-slate-900 hover:brightness-95 transition-all flex items-center self-stretch"
              style={{ backgroundColor: 'var(--bs)' }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-3">
          {/* User dropdown */}
          <details className="relative group">
            <summary className="list-none cursor-pointer select-none flex flex-col items-end leading-tight text-white/80 hover:text-white focus:outline-none rounded">
              {userName && <span className="text-xs opacity-70">{userName}</span>}
              <span className="text-sm font-semibold">My Account</span>
            </summary>
            <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
              <Link href="/orders" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Orders</Link>
              <Link href="/projects" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Projects</Link>
              <hr className="my-1 border-slate-100" />
              <Link href="/settings" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Profile</Link>
              <hr className="my-1 border-slate-100" />
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:text-red-600 transition-colors"
              >
                {signOutLabel}
              </button>
            </div>
          </details>

          <LanguageSwitcher currentLang={lang} />
        </div>
      </div>
    </header>
  )
}
