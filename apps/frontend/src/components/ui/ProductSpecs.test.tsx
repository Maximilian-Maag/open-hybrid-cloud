import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Parameter } from '@open-hybrid-cloud/types'
import { ProductSpecs } from './ProductSpecs'

const param = (over: Partial<Parameter> = {}): Parameter => ({
  id: 1,
  scope: 'product',
  scopeId: 1,
  environmentId: null,
  name: 'size',
  label: 'Size',
  type: 'string',
  description: '',
  defaultValue: 'small',
  required: false,
  sensitive: false,
  sizeValues: {},
  ...over,
})

/** The cells of the row whose header is `label`, in column order. */
const cells = (label: string) => {
  const header = screen.getByRole('rowheader', { name: new RegExp(label) })
  const row = header.closest('tr') as HTMLElement
  return within(row).getAllByRole('cell').map((c) => c.textContent?.trim())
}

describe('ProductSpecs', () => {
  it('renders one row per parameter name, not one per environment', () => {
    // `GET /api/catalog/{id}` resolves one definition per (name, environment) while
    // no environment is selected, which is how the product page always loads it.
    render(
      <ProductSpecs
        lang="en"
        parameters={[
          param({ id: 1, environmentId: 1 }),
          param({ id: 2, environmentId: 2 }),
          param({ id: 3, environmentId: 3 }),
        ]}
      />,
    )

    expect(screen.getAllByRole('rowheader')).toHaveLength(1)
  })

  it('shows the value where every environment agrees on it', () => {
    render(
      <ProductSpecs
        lang="en"
        parameters={[
          param({ id: 1, environmentId: 1, defaultValue: 'small', required: true }),
          param({ id: 2, environmentId: 2, defaultValue: 'small', required: true }),
        ]}
      />,
    )

    expect(cells('Size')).toEqual(['string', 'small', 'Yes'])
  })

  it('says the default depends on the environment rather than picking one', () => {
    // The bug this replaces: deduping by name alone showed whichever variant the
    // Map happened to keep, so the table stated one environment's default as if it
    // were the product's.
    render(
      <ProductSpecs
        lang="en"
        parameters={[
          param({ id: 1, environmentId: 1, defaultValue: 'small' }),
          param({ id: 2, environmentId: 2, defaultValue: 'large' }),
        ]}
      />,
    )

    expect(cells('Size')).toEqual(['string', 'Per environment', 'No'])
  })

  it('says the same about a requirement that differs between environments', () => {
    render(
      <ProductSpecs
        lang="en"
        parameters={[
          param({ id: 1, environmentId: 1, required: true }),
          param({ id: 2, environmentId: 2, required: false }),
        ]}
      />,
    )

    expect(cells('Size')).toEqual(['string', 'small', 'Per environment'])
  })

  it('says the same about a type that differs between environments', () => {
    render(
      <ProductSpecs
        lang="en"
        parameters={[
          param({ id: 1, environmentId: 1, type: 'string' }),
          param({ id: 2, environmentId: 2, type: 'number' }),
        ]}
      />,
    )

    expect(cells('Size')?.[0]).toBe('Per environment')
  })

  it('redacts a sensitive default that any environment marks sensitive', () => {
    // The disagreement must not be reported in a way that leaks the value, and one
    // environment calling it a secret is enough to treat it as one everywhere.
    render(
      <ProductSpecs
        lang="en"
        parameters={[
          param({ id: 1, environmentId: 1, defaultValue: 'hunter2', sensitive: true }),
          param({ id: 2, environmentId: 2, defaultValue: 'letmein', sensitive: false }),
        ]}
      />,
    )

    const row = cells('Size')
    expect(row?.[1]).toBe('Hidden sensitive values:')
    expect(row?.[1]).not.toContain('hunter2')
    expect(row?.[1]).not.toContain('letmein')
  })

  it('still shows a single definition unchanged', () => {
    render(<ProductSpecs lang="en" parameters={[param({ required: true, defaultValue: 'medium' })]} />)
    expect(cells('Size')).toEqual(['string', 'medium', 'Yes'])
  })

  it('renders nothing at all when there are no parameters', () => {
    const { container } = render(<ProductSpecs lang="en" parameters={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
