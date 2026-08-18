import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InfraFacets } from '@open-hybrid-cloud/types'

const replace = vi.fn()
let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/infrastructure',
  useSearchParams: () => currentParams,
}))

import { InfraFilters } from './InfraFilters'

const facets: InfraFacets = {
  environments: [{ id: 1, name: 'AWS Frankfurt' }, { id: 2, name: 'On-Premise Vienna' }],
  projects: [{ id: 10, name: 'Webshop Platform' }],
  products: [{ id: 20, name: 'Nginx Gateway' }],
}

const renderBar = (qs = '') => {
  currentParams = new URLSearchParams(qs)
  return render(<InfraFilters facets={facets} lang="en" resultCount={3} />)
}

beforeEach(() => {
  replace.mockReset()
})

describe('InfraFilters', () => {
  it('writes a chosen filter into the URL', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.selectOptions(screen.getByLabelText(/^status$/i), 'active')
    expect(replace).toHaveBeenCalledWith('/infrastructure?status=active')
  })

  it('keeps filters that are already set when adding another', async () => {
    const user = userEvent.setup()
    renderBar('status=active')

    await user.selectOptions(screen.getByLabelText(/^environment$/i), '2')
    const url = replace.mock.calls[0][0] as string
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('status')).toBe('active')
    expect(params.get('environmentId')).toBe('2')
  })

  it('drops a filter from the URL rather than leaving it empty', async () => {
    const user = userEvent.setup()
    renderBar('status=active&search=nginx')

    // Selecting the placeholder clears the filter.
    await user.selectOptions(screen.getByLabelText(/^status$/i), '')
    expect(replace).toHaveBeenCalledWith('/infrastructure?search=nginx')
  })

  it('debounces the search box into a single navigation', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.type(screen.getByLabelText(/^search$/i), 'nginx')
    // Nothing yet — a navigation per keystroke would hammer the API.
    expect(replace).not.toHaveBeenCalled()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/infrastructure?search=nginx'), {
      timeout: 2000,
    })
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('splits the combined sort control into sort and direction', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.selectOptions(screen.getByLabelText(/sort by/i), 'name:asc')
    const params = new URLSearchParams((replace.mock.calls[0][0] as string).split('?')[1])
    expect(params.get('sort')).toBe('name')
    expect(params.get('direction')).toBe('asc')
  })

  it('shows an active-filter count and hides Clear when nothing is filtered', () => {
    const { unmount } = renderBar()
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
    unmount()

    renderBar('status=active&search=nginx&sort=name')
    // sort/direction are presentation, not filters — they must not be counted.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()
  })

  it('Clear filters strips the whole query string', async () => {
    const user = userEvent.setup()
    renderBar('status=active&search=nginx')

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(replace).toHaveBeenCalledWith('/infrastructure')
  })

  it('reflects the URL state in the controls so a bookmarked view renders filled in', () => {
    renderBar('status=decommissioned&environmentId=2&projectId=10&search=nginx&deployedFrom=2026-03-01')

    expect(screen.getByLabelText(/^search$/i)).toHaveValue('nginx')
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('decommissioned')
    expect(screen.getByLabelText(/^environment$/i)).toHaveValue('2')
    expect(screen.getByLabelText(/^project$/i)).toHaveValue('10')
    expect(screen.getByLabelText(/deployed from/i)).toHaveValue('2026-03-01')
  })

  it('announces the result count in a live region', () => {
    renderBar()
    // The list re-renders below without moving focus, so this is the only
    // feedback a screen-reader user gets that the filter took effect.
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('3 matching elements')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('offers only the facet values that actually occur', () => {
    renderBar()
    const envSelect = screen.getByLabelText(/^environment$/i)
    expect(envSelect).toHaveTextContent('AWS Frankfurt')
    expect(envSelect).toHaveTextContent('On-Premise Vienna')
    // Placeholder plus the two real environments.
    expect(envSelect.querySelectorAll('option')).toHaveLength(3)
  })
})
