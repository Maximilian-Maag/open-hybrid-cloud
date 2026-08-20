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

// focus-visible:ring-2 needs an explicit ring COLOUR. Tailwind v4 leaves
// --tw-ring-color unset otherwise, so the ring renders fully transparent and the
// button has no visible focus indicator at all (WCAG 2.4.7) — which is what this
// component shipped with until the a11y gate caught it. ring-offset-white keeps
// the ring readable where a button sits on a tinted card.
const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

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
        className={`${base} ${sizeClass[size]} border hover:brightness-95 ${className}`}
        style={{
          backgroundColor: 'var(--bs)',
          color: 'var(--bs-ink)',
          // The fill alone is not always a visible control: an operator whose
          // secondary colour is near-white (#f5f5f4 is a real configuration here)
          // gets a button indistinguishable from the page, which reads as disabled
          // and fails WCAG 1.4.11. --bs-edge is that colour darkened to 3:1 against
          // the page, so the boundary is always there; on a saturated colour it is
          // close enough to the fill to look like a deliberate outline.
          borderColor: 'var(--bs-edge, transparent)',
          ...(style as CSSProperties),
        }}
        {...props}
      >
        {children}
      </button>
    )
  }

  // Affordance, not just semantics. `danger` and `ghost` used to be bare text —
  // real <button> elements, so axe was satisfied and a screen reader announced them
  // correctly, but a sighted user could not tell they were controls until the
  // pointer was already on them. They are used 35 times, mostly for destructive
  // actions: Delete, Decommission, Reject, Remove.
  const variantClass: Record<Exclude<Variant, 'primary'>, string> = {
    secondary: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
    // Outlined in its own colour: a destructive action should look like a control
    // you can see the edges of. red-700 rather than red-600 for 6:1 on white.
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:border-red-300',
    // Deliberately not bordered — that would make it indistinguishable from
    // `secondary`. Underlined instead, which is the other affordance everyone
    // reads as "this does something".
    ghost:
      'text-slate-700 underline decoration-slate-400 underline-offset-2 hover:bg-slate-100 hover:decoration-slate-700',
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
