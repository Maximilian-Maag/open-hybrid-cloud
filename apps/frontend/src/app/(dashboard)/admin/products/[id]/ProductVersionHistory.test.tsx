import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProductVersion, ProductVersionDiff } from '@open-hybrid-cloud/types'

vi.mock('@/lib/api', () => ({ get: vi.fn() }))

import { ProductVersionHistory } from './ProductVersionHistory'
import { get } from '@/lib/api'

const mockedGet = vi.mocked(get)

const version = (over?: Partial<ProductVersion>): ProductVersion => ({
  id: 1,
  productId: 7,
  environmentId: 2,
  changelog: '',
  summary: 'Offering updated: price',
  snapshot: { version: 1 } as ProductVersion['snapshot'],
  createdBy: 5,
  createdAt: '2026-06-01T10:00:00.000Z',
  authorName: 'Root User',
  environmentName: 'AWS Frankfurt',
  ...over,
})

const diff = (over?: Partial<ProductVersionDiff>): ProductVersionDiff => ({
  fields: [],
  parameters: [],
  identical: true,
  fromVersionId: 1,
  toVersionId: 2,
  ...over,
})

/** Wire the two GETs the panel makes: the list, then the diff on demand. */
const mockApi = (versions: ProductVersion[], diffResult?: ProductVersionDiff | Error) => {
  mockedGet.mockImplementation((async (path: string) => {
    if (path.includes('/versions/diff')) {
      if (diffResult instanceof Error) throw diffResult
      return diffResult ?? diff()
    }
    if (path.includes('/versions')) return versions
    return []
  }) as never)
}

const renderPanel = () => render(<ProductVersionHistory productId={7} token="t" lang="en" />)

beforeEach(() => {
  mockedGet.mockReset()
})

describe('ProductVersionHistory', () => {
  it('shows an empty state rather than a bare table', async () => {
    mockApi([])
    renderPanel()
    expect(await screen.findByText(/no history recorded yet/i)).toBeInTheDocument()
  })

  it('lists entries with date, environment, summary, changelog and author', async () => {
    mockApi([version({ changelog: 'Annual price review' })])
    renderPanel()

    const row = await screen.findByTestId('version-1')
    expect(within(row).getByText('AWS Frankfurt')).toBeInTheDocument()
    expect(within(row).getByText('Offering updated: price')).toBeInTheDocument()
    expect(within(row).getByText('Annual price review')).toBeInTheDocument()
    expect(within(row).getByText('Root User')).toBeInTheDocument()
  })

  it('shows a dash for a product-level entry with no environment', async () => {
    // Genuinely no environment, which is different from missing data.
    mockApi([version({ environmentId: null, environmentName: null, snapshot: null, changelog: '' })])
    renderPanel()

    const row = await screen.findByTestId('version-1')
    expect(within(row).getAllByText('—')).toHaveLength(2)
  })

  it('hides the compare controls when fewer than two entries can be diffed', async () => {
    // A product-level change carries no snapshot, so there is nothing to compare.
    mockApi([version({ id: 1 }), version({ id: 2, snapshot: null, environmentId: null, environmentName: null })])
    renderPanel()

    await screen.findByTestId('version-1')
    expect(screen.queryByRole('button', { name: /compare/i })).not.toBeInTheDocument()
  })

  it('preselects the two most recent comparable entries', async () => {
    // "What did my last change do?" should be one click.
    mockApi([version({ id: 9 }), version({ id: 8 }), version({ id: 7 })])
    renderPanel()

    await screen.findByRole('button', { name: /compare/i })
    expect(screen.getByLabelText(/^to$/i)).toHaveValue('9')
    expect(screen.getByLabelText(/^from$/i)).toHaveValue('8')
  })

  it('excludes snapshot-less entries from the compare options', async () => {
    mockApi([
      version({ id: 9 }),
      version({ id: 8, snapshot: null, environmentId: null, environmentName: null }),
      version({ id: 7 }),
    ])
    renderPanel()

    await screen.findByRole('button', { name: /compare/i })
    const select = screen.getByLabelText(/^from$/i)
    expect(within(select).queryByRole('option', { name: /#8/ })).not.toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /#7/ })).toBeInTheDocument()
  })

  it('renders a field change as before → after', async () => {
    mockApi(
      [version({ id: 9 }), version({ id: 8 })],
      diff({ identical: false, fields: [{ field: 'price', from: '10.00', to: '25.00' }] }),
    )
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /compare/i }))
    const panel = await screen.findByTestId('version-diff')
    expect(within(panel).getByText('price')).toBeInTheDocument()
    expect(within(panel).getByText('10.00')).toBeInTheDocument()
    expect(within(panel).getByText('25.00')).toBeInTheDocument()
  })

  it('renders added, removed and changed parameters', async () => {
    const param = { name: 'X', label: '', type: 'string', description: '', defaultValue: '', required: false, sensitive: false }
    mockApi(
      [version({ id: 9 }), version({ id: 8 })],
      diff({
        identical: false,
        parameters: [
          { kind: 'added', name: 'SIZE', to: param },
          { kind: 'removed', name: 'OLD', from: param },
          { kind: 'changed', name: 'REGION', fields: [{ field: 'defaultValue', from: 'eu', to: 'us' }] },
        ],
      }),
    )
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /compare/i }))
    const panel = await screen.findByTestId('version-diff')
    expect(within(panel).getByText('added')).toBeInTheDocument()
    expect(within(panel).getByText('removed')).toBeInTheDocument()
    expect(within(panel).getByText('changed')).toBeInTheDocument()
    expect(within(panel).getByText(/defaultValue: was eu, now us/)).toBeInTheDocument()
  })

  /**
   * The direction of a change, in words (#186).
   *
   * A root admin reviewing what a catalogue change did used to hear
   * "price 10.00 12.00". `line-through` is not announced by default by NVDA,
   * JAWS or VoiceOver, red vs green is signalling by colour alone (1.4.1), and
   * the arrow that carried the whole meaning was aria-hidden.
   */
  it('says which value is the old one and which is the new one, in words', async () => {
    mockApi(
      [version({ id: 9 }), version({ id: 8 })],
      diff({ identical: false, fields: [{ field: 'price', from: '10.00', to: '25.00' }] }),
    )
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /compare/i }))
    const panel = await screen.findByTestId('version-diff')
    // The whole row read as one string, which is what a screen reader gets.
    expect(panel.textContent).toContain('price was 10.00')
    expect(panel.textContent).toContain('now 25.00')
  })

  it('names an absent value instead of drawing a glyph most voices skip', async () => {
    // `∅` rendered for an empty field, and most voices skip it — so
    // "price ∅ → 12.00" and "price 12.00" were the same announcement, and the
    // reader could not tell whether the price IS that or BECAME it.
    mockApi(
      [version({ id: 9 }), version({ id: 8 })],
      diff({ identical: false, fields: [{ field: 'price', from: '', to: '12.00' }] }),
    )
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /compare/i }))
    const panel = await screen.findByTestId('version-diff')
    expect(panel.textContent).toContain('was empty')
    expect(panel.textContent).not.toContain('∅')
  })

  it('says so when two versions are identical', async () => {
    mockApi([version({ id: 9 }), version({ id: 8 })], diff({ identical: true }))
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /compare/i }))
    expect(await screen.findByText(/no difference between these versions/i)).toBeInTheDocument()
  })

  it('surfaces a diff failure without losing the history', async () => {
    mockApi(
      [version({ id: 9 }), version({ id: 8 })],
      new Error('One of these versions has no configuration snapshot to compare'),
    )
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /compare/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no configuration snapshot/i)
    expect(screen.getByTestId('version-9')).toBeInTheDocument()
  })

  it('reports a failed history load instead of an empty history', async () => {
    // An empty table would read as "nothing has ever changed".
    mockedGet.mockRejectedValue(new Error('offline'))
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i)
    expect(screen.queryByText(/no history recorded yet/i)).not.toBeInTheDocument()
  })

  it('requests the diff for the selected pair', async () => {
    const user = userEvent.setup()
    mockApi([version({ id: 9 }), version({ id: 8 }), version({ id: 7 })])
    renderPanel()

    await user.selectOptions(await screen.findByLabelText(/^from$/i), '7')
    await user.click(screen.getByRole('button', { name: /compare/i }))

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/api/admin/products/7/versions/diff?from=7&to=9', 't'),
    )
  })

  it('clears a shown diff when the selection changes', async () => {
    // Otherwise the panel would keep showing a comparison of a different pair.
    const user = userEvent.setup()
    mockApi([version({ id: 9 }), version({ id: 8 }), version({ id: 7 })], diff({ identical: true }))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /compare/i }))
    expect(await screen.findByTestId('version-diff')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/^from$/i), '7')
    expect(screen.queryByTestId('version-diff')).not.toBeInTheDocument()
  })
})
