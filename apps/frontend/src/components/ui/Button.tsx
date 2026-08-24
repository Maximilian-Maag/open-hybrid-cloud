import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentProps, CSSProperties, ReactNode } from 'react'

/**
 * Which colour each variant paints, and when to reach for it.
 *
 * The names are a known trap: this component's `primary` uses the branding's
 * **secondary** colour (`--bs`), while the branding's *primary* (`--bp`) is what
 * the header and nav are painted in. That is deliberate — with the shipped palette
 * (#131921 navy + #febd69 amber) the amber secondary is the call-to-action colour,
 * exactly as a shop would use it — but reading either name the other way sends you
 * looking in the wrong place.
 *
 * | Variant | Paints | Use for |
 * |---|---|---|
 * | `primary` | `--bs` fill, `--bs-edge` border, `--bs-ink` text | the one action the screen is for |
 * | `secondary` | white fill, slate border | everything alongside it |
 * | `danger` | white fill, red border, red text | destructive actions |
 * | `ghost` | no fill, underlined | a quiet action where a bordered button would crowd the layout |
 *
 * Every variant carries a visible boundary or an underline: `danger` and `ghost`
 * used to be bare text, indistinguishable from a label until hovered.
 */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
  size?: Size
}

/**
 * `size` is now about type and horizontal weight, not height.
 *
 * WCAG 2.5.5 wants 44x44 CSS px, and these were 28 / 36 / 44 — only `lg` cleared
 * it. The floor lives in `base` as `min-h-11 min-w-11` rather than here, so no
 * size can drop below it and a caller passing `className` cannot shrink it back.
 *
 * The alternative — keep the small box and stretch the hit area with an absolutely
 * positioned 44px pseudo-element — was rejected on purpose. Table rows and card
 * headers put these buttons 8px apart, so invisible 44px targets would overlap
 * each other, and a target you cannot see the edges of that steals its
 * neighbour's clicks is worse for motor-impaired users than a small one. Rows get
 * taller instead.
 */
const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

// focus-visible:ring-2 needs an explicit ring COLOUR. This comment used to say
// Tailwind v4 leaves --tw-ring-color unset and the ring therefore renders
// transparent. That is wrong, and reasoning from it mis-triages the real cases:
// in 4.3.1 the fallback is `currentcolor`, so an uncoloured ring is painted in
// the element's own text colour. Transparent is harmless-looking; currentcolor
// is worse, because it is invisible exactly when the text colour matches the
// ground behind the ring — which is what happened to the sign-in button, whose
// currentColor is --bp-ink (#ffffff on the shipped primary) against a #fff
// offset on a white card (WCAG 2.4.7). ring-offset-white keeps the ring
// readable where a button sits on a tinted card.
//
// min-h-11/min-w-11 is 44px: the WCAG 2.5.5 target size. It is a MINIMUM, so a
// wide button keeps its width and an icon-only one gets squared off — which is
// where the old sizes hurt most (a 20px close icon in a 28px box).
const base =
  'inline-flex items-center justify-center gap-2 min-h-11 min-w-11 rounded-md font-medium transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

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

/**
 * The paint for one variant, as the props any element can carry.
 *
 * Extracted so `Button` and `ButtonLink` cannot drift: the alternative — a caller
 * copying the class string onto its own `<Link>` — is what `InfraActions` did, and
 * every change to `base` silently left that copy behind.
 */
function appearance(
  variant: Variant,
  size: Size,
  className: string,
): { className: string; style?: CSSProperties } {
  if (variant === 'primary') {
    return {
      className: `${base} ${sizeClass[size]} border hover:brightness-95 ${className}`,
      style: {
        backgroundColor: 'var(--bs)',
        color: 'var(--bs-ink)',
        // The fill alone is not always a visible control: an operator whose
        // secondary colour is near-white (#f5f5f4 is a real configuration here)
        // gets a button indistinguishable from the page, which reads as disabled
        // and fails WCAG 1.4.11. --bs-edge is that colour darkened to 3:1 against
        // the page, so the boundary is always there; on a saturated colour it is
        // close enough to the fill to look like a deliberate outline.
        borderColor: 'var(--bs-edge, transparent)',
      },
    }
  }

  return { className: `${base} ${sizeClass[size]} ${variantClass[variant]} ${className}` }
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  style,
  children,
  ...props
}: ButtonProps) {
  const look = appearance(variant, size, className)
  return (
    <button className={look.className} style={{ ...look.style, ...(style as CSSProperties) }} {...props}>
      {children}
    </button>
  )
}

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, 'children'> & {
  variant?: Variant
  size?: Size
  children: ReactNode
}

/**
 * A navigation that looks like a button.
 *
 * Use this instead of `<Link><Button/></Link>`. That wrap renders `<a><button>`:
 * invalid HTML — an `<a>` may not contain interactive content — and one control
 * split in two, the button taking the pointer while the link keeps the keyboard.
 *
 * No gate catches it. axe's `nested-interactive` only matches roles whose
 * children are presentational and `link` is not one, so the wrap reached six call
 * sites with every check green; a11y.test.tsx pins that measurement and scans the
 * source instead.
 *
 * The element is an `<a>` — a destination, announced as a link — and only the
 * paint comes from `Button`.
 */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  style,
  children,
  ...props
}: ButtonLinkProps) {
  const look = appearance(variant, size, className)
  return (
    <Link className={look.className} style={{ ...look.style, ...(style as CSSProperties) }} {...props}>
      {children}
    </Link>
  )
}
