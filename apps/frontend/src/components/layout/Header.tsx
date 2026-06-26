'use client'

import { signOut } from 'next-auth/react'
import { Button } from '@/components/ui/Button'

interface HeaderProps {
  userName?: string | null
  shopName?: string
}

export function Header({ userName, shopName = 'Open Hybrid Cloud' }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <span className="text-base font-semibold text-slate-700">{shopName}</span>
      <div className="flex items-center gap-4">
        {userName && (
          <span className="text-sm text-slate-500">
            {userName}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: '/login' })}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </Button>
      </div>
    </header>
  )
}
