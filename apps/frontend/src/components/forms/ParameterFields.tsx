'use client'

import { useState, useEffect } from 'react'
import type { Parameter } from '@open-hybrid-cloud/types'
import { Input } from '@/components/ui/Input'

interface ParameterFieldsProps {
  parameters: Parameter[]
  values?: Record<string, string>
  onChange: (values: Record<string, string>) => void
}

export function ParameterFields({ parameters, values: externalValues, onChange }: ParameterFieldsProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const p of parameters) {
      init[p.name] = externalValues?.[p.name] ?? p.defaultValue ?? ''
    }
    return init
  })

  useEffect(() => {
    onChange(values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(name: string, value: string) {
    const next = { ...values, [name]: value }
    setValues(next)
    onChange(next)
  }

  if (parameters.length === 0) return null

  return (
    <div className="space-y-4">
      {parameters.map((param) => {
        const value = values[param.name] ?? ''

        if (param.type === 'bool') {
          return (
            <div key={param.id} className="flex items-start gap-3">
              <input
                id={`param-${param.id}`}
                type="checkbox"
                checked={value === 'true'}
                onChange={(e) => update(param.name, e.target.checked ? 'true' : 'false')}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <label htmlFor={`param-${param.id}`} className="text-sm font-medium text-slate-700">
                  {param.name}
                  {param.required && <span className="ml-1 text-red-500">*</span>}
                </label>
                {param.description && (
                  <p className="text-xs text-slate-500">{param.description}</p>
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
                {param.name}
                {param.required && <span className="ml-1 text-red-500">*</span>}
              </label>
              {param.description && <p className="text-xs text-slate-500">{param.description}</p>}
              <select
                id={`param-${param.id}`}
                value={value}
                onChange={(e) => update(param.name, e.target.value)}
                required={param.required}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select…</option>
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
            label={param.name}
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
