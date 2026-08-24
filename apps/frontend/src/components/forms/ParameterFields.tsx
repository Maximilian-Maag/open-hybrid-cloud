'use client'

import type { Parameter } from '@open-hybrid-cloud/types'
import { Input } from '@/components/ui/Input'
import { t } from '@/lib/i18n'

interface ParameterFieldsProps {
  parameters: Parameter[]
  values?: Record<string, string>
  onChange: (values: Record<string, string>) => void
  /**
   * Only used for the dropdown's empty option. Defaulted rather than required so
   * the two dozen call sites do not all have to change, and because the string
   * it governs is one word — but every caller in the app passes it.
   */
  lang?: string
}

// Fully controlled: the parent owns `values`, we only render and forward
// changes. An earlier version kept a local copy synchronised through a
// useEffect on `values`, which re-fired every parent render because the
// prop reference changed each time — the effect then called setValues +
// onChange, triggering another parent render, and so on. The infinite
// re-render loop swallowed keystrokes ("hostname does not update") and
// disabled the Cost Center Select ("cannot be selected"). Removing the
// internal state and the sync effect fixes both.
export function ParameterFields({ parameters, values, onChange, lang = 'en' }: ParameterFieldsProps) {
  if (parameters.length === 0) return null

  const getValue = (p: Parameter): string => values?.[p.name] ?? p.defaultValue ?? ''
  // Prefer the human-friendly label (manually set or generated from Terraform),
  // falling back to the raw variable name when no label is configured.
  const displayLabel = (p: Parameter): string => p.label?.trim() || p.name

  const update = (name: string, value: string) => {
    onChange({ ...(values ?? {}), [name]: value })
  }

  return (
    <div className="space-y-4">
      {parameters.map((param) => {
        const value = getValue(param)

        // The description is the operator's explanation of what the parameter
        // does, and it was drawn but not wired: the <p> had no id and the
        // control no aria-describedby, so the same sentence was announced for a
        // text parameter (which goes through Input, and Input does wire it) and
        // silently dropped for a checkbox or a dropdown (1.3.1, 3.3.2).
        const describedBy = param.description ? `param-${param.id}-desc` : undefined

        if (param.type === 'bool') {
          return (
            <div key={param.id} className="flex items-start gap-3">
              <input
                id={`param-${param.id}`}
                type="checkbox"
                checked={value === 'true'}
                aria-describedby={describedBy}
                onChange={(e) => update(param.name, e.target.checked ? 'true' : 'false')}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <label htmlFor={`param-${param.id}`} className="text-sm font-medium text-slate-700">
                  {displayLabel(param)}
                  {param.required && <span className="ml-1 text-red-700">*</span>}
                </label>
                {param.description && (
                  <p id={describedBy} className="text-xs text-slate-500">{param.description}</p>
                )}
              </div>
            </div>
          )
        }

        if (param.type === 'dropdown') {
          const options = param.defaultValue.split(',').map((v) => v.trim()).filter(Boolean)
          return (
            <div key={param.id} className="flex flex-col gap-1">
              <label htmlFor={`param-${param.id}`} className="text-sm font-medium text-slate-700">
                {displayLabel(param)}
                {param.required && <span className="ml-1 text-red-700">*</span>}
              </label>
              {param.description && (
                <p id={describedBy} className="text-xs text-slate-500">{param.description}</p>
              )}
              <select
                id={`param-${param.id}`}
                value={value}
                aria-describedby={describedBy}
                onChange={(e) => update(param.name, e.target.value)}
                required={param.required}
                className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {/* Was a literal "Select…" — English inside a document declaring
                    another language (3.1.2), and the only untranslated string in
                    this component. */}
                <option value="">{t('selectOption', lang)}</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          )
        }

        return (
          <Input
            key={param.id}
            label={displayLabel(param)}
            type={param.type === 'number' ? 'number' : param.sensitive ? 'password' : 'text'}
            value={value}
            onChange={(e) => update(param.name, e.target.value)}
            required={param.required}
            hint={param.description || undefined}
            placeholder={param.defaultValue || undefined}
          />
        )
      })}
    </div>
  )
}
