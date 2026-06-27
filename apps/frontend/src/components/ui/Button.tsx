import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variantClass: Record<Variant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 border-transparent',
  secondary:
    'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 focus:ring-blue-500',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 border-transparent',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-400 border-transparent',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const sizeClass =
    size === 'sm'
      ? 'px-3 py-1.5 text-xs'
      : size === 'lg'
        ? 'px-5 py-2.5 text-base'
        : 'px-4 py-2 text-sm'

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${variantClass[variant]} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
