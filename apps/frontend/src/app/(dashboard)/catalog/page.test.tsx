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
  { id: 10, categoryId: 1, baseLanguage: 'en', createdAt: '', name: 'Managed Postgres', description: 'A database' },
  { id: 11, categoryId: 2, baseLanguage: 'en', createdAt: '', name: 'Nginx Gateway', description: 'A proxy' },
] as unknown as Product[]

/** Wire the three GETs the page fires, with a configurable favourites payload. */
const mockApi = (favorites: number[], opts: { favoritesFail?: boolean } = {}) => {
  mockedGet.mockImplementation((async (path: string) => {
    if (path.startsWith('/api/catalog')) return products
    if (path.startsWith('/api/admin/categories')) return categories
    if (path.startsWith('/api/favorites')) {
      if (opts.favoritesFail) throw new Error('favorites down')
      return favorites.map((productId) => ({
        productId,
        categoryId: 1,
        name: 'x',
        description: '',
        createdAt: '',
      })) as FavoriteProduct[]
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
      if (path.startsWith('/api/catalog')) return products
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
