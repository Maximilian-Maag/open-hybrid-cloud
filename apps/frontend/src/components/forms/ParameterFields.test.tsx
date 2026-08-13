import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParameterFields } from './ParameterFields'
import type { Parameter } from '@open-hybrid-cloud/types'

const base: Parameter = {
  id: 1,
  scope: 'product',
  scopeId: 1,
  environmentId: null,
  name: 'HOSTNAME',
  label: '',
  type: 'string',
  description: '',
  defaultValue: '',
  required: false,
  sensitive: false,
}

describe('ParameterFields', () => {
  it('renders the human-friendly label when one is set', () => {
    render(
      <ParameterFields
        parameters={[{ ...base, label: 'Host name' }]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Host name')).toBeInTheDocument()
  })

  it('falls back to the variable name when no label is set', () => {
    render(<ParameterFields parameters={[base]} onChange={() => {}} />)
    expect(screen.getByLabelText('HOSTNAME')).toBeInTheDocument()
  })
})
