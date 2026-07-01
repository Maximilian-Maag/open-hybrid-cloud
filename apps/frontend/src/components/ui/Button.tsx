import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClass = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  style,
  children,
  ...props
}: ButtonProps) {
  if (variant === 'primary') {
    return (
      <button
        className={`${base} ${sizeClass[size]} text-gray-900 hover:brightness-95 ${className}`}
        style={{ backgroundColor: 'var(--bs)', ...(style as CSSProperties) }}
        {...props}
      >
        {children}
      </button>
    )
  }

  const variantClass: Record<Exclude<Variant, 'primary'>, string> = {
    secondary: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
    danger: 'text-red-600 hover:bg-red-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }

  return (
    <button
      className={`${base} ${sizeClass[size]} ${variantClass[variant as Exclude<Variant, 'primary'>]} ${className}`}
      style={style}
      {...props}
    >
      {children}
    </button>
  )
}
