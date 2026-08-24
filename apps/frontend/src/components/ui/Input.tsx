import { useId, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export function Input({ label, error, hint, id, className = '', ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {label}
        {/* red-700, not red-500, and no gate would ever have said so. axe skips
            glyph-only text: `colorContrastMatches` gates on `hasRealTextChildren`,
            which strips punctuation first — `*` leaves an empty string, so the
            span is excluded from `color-contrast` entirely (axe-core 4.13.0). It
            measured 3.81:1 on white against the 4.5:1 AA needs; red-700 is 6.42
            on white and 6.14 on slate-50, and is already the app's red for text
            (see Button's `danger`). The same span is in Select and
            ParameterFields — all four have to move together. */}
        {props.required && <span className="ml-1 text-red-700">*</span>}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        // min-h-11 is the WCAG 2.5.5 target size. A text field is a pointer
        // target like any other, and px-3 py-2 on text-sm came to 38px.
        className={`min-h-11 rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 ${
          error ? 'border-red-400 bg-red-50' : 'border-slate-300'
        } ${className}`}
        {...props}
      />
      {hint && !error && <p id={hintId} className="text-xs text-slate-500">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
