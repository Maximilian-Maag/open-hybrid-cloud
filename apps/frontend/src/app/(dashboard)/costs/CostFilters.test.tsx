import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@open-hybrid-cloud/types'

const replace = vi.fn()
let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/costs',
  useSearchParams: () => currentParams,
}))

import { CostFilters } from './CostFilters'

const projects: Project[] = [
  { id: 10, name: 'Webshop Platform', description: '', ownerId: 1, costCenterId: null, createdAt: '2026-01-01' },
  { id: 11, name: 'Data Lake', description: '', ownerId: 1, costCenterId: null, createdAt: '2026-01-01' },
]

const renderBar = (qs = '') => {
  currentParams = new URLSearchParams(qs)
  return render(<CostFilters projects={projects} lang="en" />)
}

const paramsOf = (call = 0) =>
  new URLSearchParams(((replace.mock.calls[call][0] as string).split('?')[1] ?? ''))

beforeEach(() => {
  replace.mockReset()
})

describe('CostFilters', () => {
  it('writes a chosen preset into the URL', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.selectOptions(screen.getByLabelText(/time range/i), 'last3Months')
    expect(replace).toHaveBeenCalledWith('/costs?range=last3Months')
  })

  it('shows all time when no range is set, matching what the API does', () => {
    renderBar()
    // Not an unset control: without a range the report has no lower bound.
    expect(screen.getByLabelText(/time range/i)).toHaveValue('all')
  })

  it('expresses all time as the absence of the parameter', async () => {
    const user = userEvent.setup()
    renderBar('range=currentMonth')

    await user.selectOptions(screen.getByLabelText(/time range/i), 'all')
    expect(replace).toHaveBeenCalledWith('/costs')
  })

  it('offers from/to dates only for a custom range', async () => {
    const user = userEvent.setup()
    renderBar()
    // A preset wins over from/to server-side, so an always-visible date input
    // would silently do nothing.
    expect(screen.queryByLabelText(/^from$/i)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/time range/i), 'custom')
    expect(replace).toHaveBeenCalledWith('/costs?range=custom')
  })

  it('renders the date inputs when the URL says custom', () => {
    renderBar('range=custom&from=2026-01-01&to=2026-03-31')
    expect(screen.getByLabelText(/^from$/i)).toHaveValue('2026-01-01')
    expect(screen.getByLabelText(/^to$/i)).toHaveValue('2026-03-31')
  })

  it('keeps the range when a project is added', async () => {
    const user = userEvent.setup()
    renderBar('range=last3Months')

    await user.selectOptions(screen.getByLabelText(/^project$/i), '10')
    const params = paramsOf()
    expect(params.get('range')).toBe('last3Months')
    expect(params.get('projectId')).toBe('10')
  })

  it('drops stale dates when switching from a custom range to a preset', async () => {
    const user = userEvent.setup()
    renderBar('range=custom&from=2026-01-01&to=2026-03-31')

    await user.selectOptions(screen.getByLabelText(/time range/i), 'currentMonth')
    const params = paramsOf()
    expect(params.get('range')).toBe('currentMonth')
    // Left behind they would be ignored by the server but still shown in a
    // shared URL, which reads as a range that is not the one being reported.
    expect(params.get('from')).toBeNull()
    expect(params.get('to')).toBeNull()
  })

  it('lets the project filter be undone in place', async () => {
    const user = userEvent.setup()
    renderBar('projectId=10')

    // Select's own placeholder renders disabled, so the bar uses a real option.
    await user.selectOptions(screen.getByLabelText(/^project$/i), '')
    expect(replace).toHaveBeenCalledWith('/costs')
    expect(screen.getByLabelText(/^project$/i).querySelectorAll('option')).toHaveLength(3)
  })

  it('shows an active-filter count and hides Clear when nothing is filtered', () => {
    const { unmount } = renderBar()
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
    unmount()

    renderBar('range=last3Months&projectId=10')
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()
  })

  it('Clear filters strips the whole query string', async () => {
    const user = userEvent.setup()
    renderBar('range=custom&from=2026-01-01&projectId=10')

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(replace).toHaveBeenCalledWith('/costs')
  })

  it('reflects a bookmarked project filter in the control', () => {
    renderBar('projectId=11')
    expect(screen.getByLabelText(/^project$/i)).toHaveValue('11')
  })
})
