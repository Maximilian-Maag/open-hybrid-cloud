import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParameterFields, SizeDerivedValues } from './ParameterFields'
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
  sizeValues: {},
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

/**
 * A `size` parameter is decided by the size the customer picked, so it gets no
 * input — and a field they could contradict would let them buy an S and
 * provision an XL. What they get is shown instead, read-only.
 */
describe('a size-typed parameter', () => {
  const sized: Parameter = {
    ...base,
    id: 9,
    name: 'instance_type',
    label: 'Instance type',
    type: 'size',
    sizeValues: { S: 't3.micro', XL: 'm6i.2xlarge' },
  }

  it('renders no input for it', () => {
    render(<ParameterFields parameters={[sized]} values={{}} onChange={() => {}} />)
    expect(screen.queryByLabelText(/instance type/i)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows what the chosen size sets', () => {
    render(<SizeDerivedValues parameters={[sized]} sizeCode="XL" />)
    expect(screen.getByText('Instance type')).toBeInTheDocument()
    expect(screen.getByText('m6i.2xlarge')).toBeInTheDocument()
    // The other size's value is not what was chosen.
    expect(screen.queryByText('t3.micro')).toBeNull()
  })

  // A size added after the mapping was written. Checkout refuses it, so it has
  // to be visible before then rather than as a surprise at the till.
  it('says so when the size has no value', () => {
    render(<SizeDerivedValues parameters={[sized]} sizeCode="M" />)
    expect(screen.getByText(/no value for this size/i)).toBeInTheDocument()
  })

  it('renders nothing without a size, or without a size parameter', () => {
    const { container: noSize } = render(<SizeDerivedValues parameters={[sized]} sizeCode={null} />)
    expect(noSize).toBeEmptyDOMElement()

    const { container: noneDriven } = render(<SizeDerivedValues parameters={[base]} sizeCode="XL" />)
    expect(noneDriven).toBeEmptyDOMElement()
  })
})
