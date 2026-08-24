import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product, Category, FavoriteProduct } from '@open-hybrid-cloud/types'

let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { apiToken: 'test-token' } }),
}))

vi.mock('@/lib/useLang', () => ({ useLang: () => 'en' }))

vi.mock('@/lib/api', () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

import CatalogPage from './page'
import { get, put, del } from '@/lib/api'

const mockedGet = vi.mocked(get)
const mockedPut = vi.mocked(put)
const mockedDel = vi.mocked(del)

const categories: Category[] = [
  { id: 1, name: 'Databases', displayOrder: 0 },
  { id: 2, name: 'Networking', displayOrder: 1 },
]

const products = [
  { id: 10, categoryId: 1, baseLanguage: 'en', createdAt: '', name: 'Managed Postgres', description: 'A database', imageAlt: 'A database server rack' },
  { id: 11, categoryId: 2, baseLanguage: 'en', createdAt: '', name: 'Nginx Gateway', description: 'A proxy', imageAlt: null },
] as unknown as Product[]

/** The endpoint pages now: one window of rows plus the total behind it (#91). */
const catalogPage = (items: Product[], total = items.length, offset = 0) => ({
  items,
  total,
  limit: 24,
  offset,
})

/**
 * A favourite as the API returns it — derived from the product so the shelf's
 * card is the same tile as the grid's, which is the property the page used to get
 * by filtering the fully-loaded catalogue.
 */
const favoriteOf = (productId: number): FavoriteProduct => {
  const product = products.find((p) => p.id === productId)
  return {
    productId,
    categoryId: product?.categoryId ?? 1,
    name: product?.name ?? 'x',
    description: product?.description ?? '',
    imageAlt: product?.imageAlt ?? null,
    createdAt: '',
  }
}

/** Wire the three GETs the page fires, with a configurable favourites payload. */
const mockApi = (favorites: number[], opts: { favoritesFail?: boolean } = {}) => {
  mockedGet.mockImplementation((async (path: string) => {
    if (path.startsWith('/api/catalog')) return catalogPage(products)
    if (path.startsWith('/api/admin/categories')) return categories
    if (path.startsWith('/api/favorites')) {
      if (opts.favoritesFail) throw new Error('favorites down')
      return favorites.map(favoriteOf)
    }
    return []
  }) as never)
}

const favoritesSection = () => screen.queryByRole('region', { name: /my favorites/i })

beforeEach(() => {
  currentParams = new URLSearchParams()
  mockedGet.mockReset()
  mockedPut.mockReset().mockResolvedValue(undefined as never)
  mockedDel.mockReset().mockResolvedValue(undefined as never)
})

describe('CatalogPage favorites', () => {
  it('marks the favourited product as pressed and the other as not', async () => {
    mockApi([11])
    render(<CatalogPage />)

    // Card 11 appears twice — once in the favourites section, once in the grid.
    const cards = await screen.findAllByTestId('product-card-11')
    expect(cards).toHaveLength(2)
    // Both must agree; a starred card that renders unstarred in one place is a
    // bug the user would read as the toggle not working.
    for (const card of cards) {
      expect(within(card).getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument()
    }
    const notFavorited = screen.getByTestId('product-card-10')
    expect(within(notFavorited).getByRole('button', { name: /add to favorites/i })).toBeInTheDocument()
  })

  it("labels a tile's picture with the description its uploader wrote", async () => {
    // Not the product name, and not empty: each component used to decide that for
    // itself — the tile and the cart passed "", the detail page passed the name.
    mockApi([])
    render(<CatalogPage />)
    const card = await screen.findByTestId('product-card-10')

    expect(within(card).getByRole('img', { name: 'A database server rack' })).toBeInTheDocument()
  })

  it('falls back to the product name when the picture has no description', async () => {
    mockApi([])
    render(<CatalogPage />)
    const card = await screen.findByTestId('product-card-11')

    expect(within(card).getByRole('img', { name: 'Nginx Gateway' })).toBeInTheDocument()
  })

  it('hides the favourites section entirely when nothing is starred', async () => {
    // An empty shelf is worse than no shelf.
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    expect(favoritesSection()).not.toBeInTheDocument()
  })

  it('shows the favourites section once something is starred', async () => {
    mockApi([10])
    render(<CatalogPage />)

    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
    const section = favoritesSection()
    if (!section) throw new Error('favourites section missing')
    expect(within(section).getByTestId('product-card-10')).toBeInTheDocument()
    expect(within(section).queryByTestId('product-card-11')).not.toBeInTheDocument()
  })

  it('does not let a slow favourites response revert a star clicked meanwhile', async () => {
    // The favourites request is deliberately not awaited, so the stars are already
    // on screen while it is in flight. Its answer is older than a click that
    // happened after it was sent, and applying it silently un-starred the product.
    const user = userEvent.setup()
    let releaseFavorites: (value: FavoriteProduct[]) => void = () => {}
    const pending = new Promise<FavoriteProduct[]>((resolve) => { releaseFavorites = resolve })

    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) return catalogPage(products)
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) return pending
      return []
    }) as never)

    render(<CatalogPage />)
    const card = await screen.findByTestId('product-card-10')
    await user.click(within(card).getByRole('button', { name: /add to favorites/i }))

    // The server answers with what it knew BEFORE the click: nothing starred.
    releaseFavorites([])
    await waitFor(() => expect(mockedPut).toHaveBeenCalledWith('/api/favorites/10', {}, 'test-token'))

    // The star stays filled — and the product now also appears in the favourites
    // section, which is what a reverted state would have hidden. (Its card is a
    // second copy of the same tile, hence getAllByTestId.)
    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
    for (const copy of screen.getAllByTestId('product-card-10')) {
      expect(within(copy).getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument()
    }
  })

  it('PUTs on star and DELETEs on un-star', async () => {
    const user = userEvent.setup()
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    const card = screen.getByTestId('product-card-10')

    await user.click(within(card).getByRole('button', { name: /add to favorites/i }))
    expect(mockedPut).toHaveBeenCalledWith('/api/favorites/10', {}, 'test-token')

    // The star flips optimistically, so the un-star action is available at once.
    await waitFor(() =>
      expect(within(screen.getAllByTestId('product-card-10')[0]).getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument(),
    )
    await user.click(within(screen.getAllByTestId('product-card-10')[0]).getByRole('button', { name: /remove from favorites/i }))
    expect(mockedDel).toHaveBeenCalledWith('/api/favorites/10', 'test-token')
  })

  it('reveals the favourites section immediately on the first star', async () => {
    const user = userEvent.setup()
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    expect(favoritesSection()).not.toBeInTheDocument()

    await user.click(within(screen.getByTestId('product-card-10')).getByRole('button', { name: /add to favorites/i }))
    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
  })

  it('rolls the star back when the request fails', async () => {
    // Otherwise the star claims a state the server never recorded.
    const user = userEvent.setup()
    mockApi([])
    mockedPut.mockRejectedValue(new Error('offline'))
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    await user.click(within(screen.getByTestId('product-card-10')).getByRole('button', { name: /add to favorites/i }))

    await waitFor(() =>
      expect(within(screen.getByTestId('product-card-10')).getByRole('button', { name: /add to favorites/i })).toBeInTheDocument(),
    )
    expect(favoritesSection()).not.toBeInTheDocument()
  })

  it('renders the catalogue even when the favourites request fails', async () => {
    // A favourites outage costs the stars, not the whole page.
    mockApi([], { favoritesFail: true })
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    expect(screen.getByTestId('product-card-11')).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('suppresses the favourites section while a search is active', async () => {
    // The section is unfiltered, so leaving it up would contradict the results.
    currentParams = new URLSearchParams('q=nginx')
    mockApi([10])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-11')).toBeInTheDocument())
    expect(favoritesSection()).not.toBeInTheDocument()
  })

  it('suppresses the favourites section while a category filter is active', async () => {
    const user = userEvent.setup()
    mockApi([10])
    render(<CatalogPage />)

    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: 'Networking' })[0])
    await waitFor(() => expect(favoritesSection()).not.toBeInTheDocument())
  })

  it('requests the favourites in the active language', async () => {
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/api/favorites?lang=en', 'test-token'))
  })
})

// Issue #91: search, category and paging happen in the database now. The page
// used to fetch the whole catalogue and filter it in the browser.
describe('CatalogPage server-side filtering and paging', () => {
  const catalogCalls = () =>
    mockedGet.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/api/catalog'))

  it('asks the endpoint for a page, not for everything', async () => {
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(catalogCalls().length).toBeGreaterThan(0))
    expect(catalogCalls()[0]).toContain('limit=24')
    expect(catalogCalls()[0]).toContain('offset=0')
  })

  it('sends the search term to the database instead of filtering in the browser', async () => {
    currentParams = new URLSearchParams('q=nginx')
    mockApi([])
    render(<CatalogPage />)

    // Debounced, so this is the request that arrives a moment after the keystroke.
    await waitFor(() => expect(catalogCalls().some((path) => path.includes('search=nginx'))).toBe(true))
  })

  it('sends the chosen category to the database', async () => {
    const user = userEvent.setup()
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: 'Networking' })[0])

    await waitFor(() => expect(catalogCalls().some((path) => path.includes('categoryId=2'))).toBe(true))
  })

  it('offers more only when there is more, and appends the next page', async () => {
    const third = { ...products[0], id: 12, name: 'Third Product' } as Product
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) {
        // Two of three on the first page, the rest on the second.
        return path.includes('offset=0')
          ? catalogPage(products, 3)
          : catalogPage([third], 3, 2)
      }
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) return []
      return []
    }) as never)

    const user = userEvent.setup()
    render(<CatalogPage />)

    const more = await screen.findByRole('button', { name: /show more/i })
    expect(screen.getByText('2 / 3 products')).toBeInTheDocument()

    await user.click(more)

    await waitFor(() => expect(screen.getByTestId('product-card-12')).toBeInTheDocument())
    // The first page is still there — appended, not replaced.
    expect(screen.getByTestId('product-card-10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  it('shows no load-more button when the page holds everything', async () => {
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })

  it('keeps an off-page favourite visible if un-starring it fails (#138)', async () => {
    // `addShelfRow`, used to restore a rolled-back row, only knows how to
    // rebuild it from `products` — which this favourite was never fetched
    // into. The rollback has to restore the row it captured instead, or the
    // card disappears for good with no way to retry.
    const user = userEvent.setup()
    const offPage = 99
    const offPageFavorite: FavoriteProduct = {
      productId: offPage,
      categoryId: 1,
      name: 'Starred but unloaded',
      description: 'On page three',
      imageAlt: null,
      createdAt: '',
    }
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) return catalogPage(products, 40)
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) return [offPageFavorite]
      return []
    }) as never)
    mockedDel.mockRejectedValue(new Error('offline'))

    render(<CatalogPage />)
    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
    let section = favoritesSection()
    if (!section) throw new Error('favourites section missing')
    const card = within(section).getByTestId(`product-card-${offPage}`)
    await user.click(within(card).getByRole('button', { name: /remove from favorites/i }))

    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith(`/api/favorites/${offPage}`, 'test-token'))

    // Rolled back: the card must still be on the shelf.
    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
    section = favoritesSection()
    if (!section) throw new Error('favourites section missing')
    expect(within(section).getByTestId(`product-card-${offPage}`)).toBeInTheDocument()
  })

  it('shows a favourite that is not on the loaded page', async () => {
    // The shelf used to be filtered out of the loaded catalogue, so paging would
    // have hidden every favourite past the first page.
    const offPage = 99
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) return catalogPage(products, 40)
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) {
        return [{
          productId: offPage,
          categoryId: 1,
          name: 'Starred but unloaded',
          description: 'On page three',
          imageAlt: null,
          createdAt: '',
        }] as FavoriteProduct[]
      }
      return []
    }) as never)

    render(<CatalogPage />)

    await waitFor(() => expect(favoritesSection()).toBeInTheDocument())
    const section = favoritesSection()
    if (!section) throw new Error('favourites section missing')
    expect(within(section).getByTestId(`product-card-${offPage}`)).toBeInTheDocument()
  })

  it('keeps the response for the category clicked last, even if it answers first (#138)', async () => {
    // Click a slow category, then a fast one, within the same tick a real
    // double-click would land in. Without a generation guard, whichever
    // response arrives LAST wins the race regardless of which category is
    // still selected — here that would be the slow, no-longer-selected one.
    const user = userEvent.setup()
    let resolveSlow: (v: ReturnType<typeof catalogPage>) => void = () => {}
    let resolveFast: (v: ReturnType<typeof catalogPage>) => void = () => {}
    let catalogCallCount = 0

    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) {
        catalogCallCount += 1
        if (catalogCallCount === 1) return catalogPage(products) // initial, unfiltered load
        if (path.includes('categoryId=1')) return new Promise((resolve) => { resolveSlow = resolve })
        if (path.includes('categoryId=2')) return new Promise((resolve) => { resolveFast = resolve })
        return catalogPage([])
      }
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) return []
      return []
    }) as never)

    render(<CatalogPage />)
    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: 'Databases' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Networking' })[0])

    // The category clicked last (Networking) answers first...
    resolveFast(catalogPage([products[1]]))
    await waitFor(() => expect(screen.getByTestId('product-card-11')).toBeInTheDocument())

    // ...then the stale, no-longer-selected category's slow answer lands.
    // It must not repaint the grid with Databases' result.
    resolveSlow(catalogPage([products[0]]))
    await waitFor(() => expect(screen.getByTestId('product-card-11')).toBeInTheDocument())
    expect(screen.queryByTestId('product-card-10')).not.toBeInTheDocument()
  })
})

/**
 * What the page SAYS when the result set changes (#186).
 *
 * Search is debounced, a category click refetches in place and "Show more"
 * appends — none of it moves focus, so the only thing that tells a screen-reader
 * user anything happened is the result count, and that was a plain <span>.
 * InfraFilters already had the right shape; this page did not use it.
 */
describe('CatalogPage announcements', () => {
  beforeEach(() => { currentParams = new URLSearchParams() })

  it('puts the result count in a live region that is present before it changes', async () => {
    mockApi([])
    render(<CatalogPage />)

    // Present from the first paint, not conditionally rendered on `total > 0`:
    // a live region inserted at the same moment as its content is not reliably
    // announced, and the case that mattered most — dropping to zero matches —
    // removed the node entirely.
    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('2 products'))
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('marks the region busy while a fetch is in flight', async () => {
    let resolve!: (v: unknown) => void
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) return new Promise((r) => { resolve = r })
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) return []
      return []
    }) as never)

    render(<CatalogPage />)
    const status = await screen.findByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')

    resolve(catalogPage(products))
    await waitFor(() => expect(status).toHaveAttribute('aria-busy', 'false'))
  })

  it('says so when appending the next page fails, instead of leaving a silent no-op', async () => {
    // The catch used to swallow the error and leave the button enabled, so a
    // failed append was indistinguishable from a successful one that added
    // nothing — for everyone, not only for screen-reader users.
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog')) {
        if (path.includes('offset=0')) return catalogPage(products, 3)
        throw new Error('network down')
      }
      if (path.startsWith('/api/admin/categories')) return categories
      if (path.startsWith('/api/favorites')) return []
      return []
    }) as never)

    const user = userEvent.setup()
    render(<CatalogPage />)

    await user.click(await screen.findByRole('button', { name: /show more/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong/i)
    // The two cards already on screen survive: this is an append failure, not a
    // load failure.
    expect(screen.getByTestId('product-card-10')).toBeInTheDocument()
  })

  it('exposes which category filter is applied, rather than only colouring it', async () => {
    // aria-pressed, not aria-current: clicking the selected category clears it,
    // which is a toggle. Colour alone is 1.4.1 and 4.1.2, and axe cannot infer
    // that a background colour means "selected".
    mockApi([])
    const user = userEvent.setup()
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())

    const all = screen.getAllByRole('button', { name: 'All products' })[0]
    expect(all).toHaveAttribute('aria-pressed', 'true')

    const databases = screen.getAllByRole('button', { name: 'Databases' })[0]
    expect(databases).toHaveAttribute('aria-pressed', 'false')

    await user.click(databases)
    expect(databases).toHaveAttribute('aria-pressed', 'true')
    expect(all).toHaveAttribute('aria-pressed', 'false')

    // Clicking it again clears the filter, which is why it is a toggle.
    await user.click(databases)
    expect(databases).toHaveAttribute('aria-pressed', 'false')
    expect(all).toHaveAttribute('aria-pressed', 'true')
  })

  it('gives the page an h1, and keeps the card headings one level below it', async () => {
    // /catalog had no h1 at all: the favourites shelf's h2 came first in the DOM
    // and the title below it was an h2 too. `page-has-heading-one` and
    // `heading-order` are both best-practice-only rules, so the gate never asked
    // for either (#185).
    mockApi([])
    render(<CatalogPage />)

    await waitFor(() => expect(screen.getByTestId('product-card-10')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: /product catalog/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Managed Postgres' })).toBeInTheDocument()
  })
})
