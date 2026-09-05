'use client'

import type { OfferingSize } from '@open-hybrid-cloud/types'
import { t } from '@/lib/i18n'

/**
 * The size picker, as a row of swatches rather than a dropdown.
 *
 * A dropdown hides the choice behind a click and shows one option at a time, so
 * comparing what S, M and XL cost means opening it and reading down a list. The
 * size IS the price here — that is the whole point of #98 — and a price the
 * shopper has to go looking for may as well not be shown. Every option, its
 * price, and which one is selected are all visible at once.
 *
 * ── Native radios, deliberately ───────────────────────────────────────────────
 * The buttons are `<label>`s over visually-hidden `<input type="radio">`s inside
 * a `<fieldset>`. That is not decoration:
 *
 *   * the group is ONE tab stop and the arrow keys move within it, which is what
 *     a keyboard user expects of a set of alternatives and what a row of
 *     `<button>`s would have to reimplement (badly);
 *   * `:checked` carries the selected state to assistive technology for free, so
 *     the visual treatment does not have to be the only signal;
 *   * `<legend>` names the group, so a screen reader announces "Size, M, 3 of 4"
 *     instead of a bare letter.
 *
 * `sr-only` and not `hidden` or `display: none` — a hidden input is not
 * focusable, which would take the keyboard support away again.
 *
 * ── Not colour alone ──────────────────────────────────────────────────────────
 * The selected swatch differs by border WEIGHT, background and font weight, not
 * only by colour (WCAG 1.4.1). Text stays dark on light throughout, so the
 * contrast does not depend on the operator's branding — which the buy box's
 * other controls also avoid depending on.
 *
 * The palette is picked against the numbers rather than by eye, because this
 * repo holds itself to AAA:
 *
 *   slate-700 price on slate-100   9.45:1   (slate-600 was 6.92 — under 7)
 *   slate-900 name on slate-100   16.30:1
 *   slate-500 border on white      4.76:1   (1.4.11 wants 3:1 for a control's
 *                                            boundary; slate-300, which the
 *                                            other inputs use, is 1.48)
 */
export function SizeSwatches({
  sizes,
  value,
  onChange,
  lang,
}: {
  sizes: OfferingSize[]
  value: string
  onChange: (code: string) => void
  lang: string
}) {
  if (sizes.length === 0) return null

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('size', lang)}</legend>
      <div className="flex flex-wrap gap-2">
        {sizes.map((size) => {
          const selected = size.code === value
          return (
            <label
              key={size.id}
              className={[
                // min-h-11: the same 44px touch target the rest of the form uses.
                'relative flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg px-3 py-1.5 text-center transition-colors',
                // focus-within, because the input itself is visually hidden — the
                // ring has to appear on the thing the eye can see.
                'focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-1',
                selected
                  ? 'border-2 border-slate-900 bg-slate-100 font-semibold text-slate-900'
                  : 'border border-slate-500 bg-white text-slate-900 hover:border-slate-900 hover:bg-slate-50',
              ].join(' ')}
            >
              <input
                type="radio"
                name="offering-size"
                value={size.code}
                checked={selected}
                onChange={() => onChange(size.code)}
                className="sr-only"
              />
              <span className="text-sm leading-tight">{size.label || size.code}</span>
              {/* The price under the name, not beside it: the shopper is
                  comparing a column of numbers, and a column reads faster. */}
              <span className="text-xs leading-tight text-slate-700">
                {size.price} {size.currency}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
