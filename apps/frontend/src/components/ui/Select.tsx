import { useId, type SelectHTMLAttributes } from 'react'

interface SelectOption {
  value: string | number
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: SelectOption[]
  error?: string
  hint?: string
  placeholder?: string
}

export function Select({
  label,
  options,
  error,
  hint,
  placeholder,
  id,
  className = '',
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const errorId = `${selectId}-error`
  // Mirrors Input: the hint is announced via aria-describedby, and the error
  // takes over that slot when present so a screen reader gets the blocker
  // rather than the tip.
  const hintId = `${selectId}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-sm font-medium text-slate-700">
        {label}
        {/* red-700 for the reason measured in Input.tsx: axe cannot check a
            glyph-only marker at all, and red-500 was 3.81:1. */}
        {props.required && <span className="ml-1 text-red-700">*</span>}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        // min-h-11 is the WCAG 2.5.5 target size. A text field is a pointer
        // target like any other, and px-3 py-2 on text-sm came to 38px.
        className={`min-h-11 rounded-lg border px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 ${
          error ? 'border-red-400 bg-red-50' : 'border-slate-300'
        } ${className}`}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && !error && <p id={hintId} className="text-xs text-slate-500">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
