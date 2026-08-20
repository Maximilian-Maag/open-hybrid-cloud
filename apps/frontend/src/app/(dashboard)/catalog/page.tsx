'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import type { Product, Category, FavoriteProduct } from '@open-hybrid-cloud/types'
import { get, put, del } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useLang } from '@/lib/useLang'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { ProductCard } from './ProductCard'

export default function CatalogPage() {
  const { data: session } = useSession()
  const token = (session as unknown as { apiToken?: string })?.apiToken
  const searchParams = useSearchParams()
  const lang = useLang()

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Favourited product ids. Held as a Set so a card can answer "am I starred?"
  // without scanning a list per render.
  const [favorites, setFavorites] = useState<Set<number>>(new Set())
  const [favoriteBusy, setFavoriteBusy] = useState<Set<number>>(new Set())
  // Bumped on every toggle. The favourites request below is not awaited, so a star
  // clicked while it is in flight is NEWER than the answer coming back — applying
  // that answer would silently revert what the user just did. Starring a product
  // immediately after the page appeared did exactly that.
  const toggleGeneration = useRef(0)

  // sync URL search param into local state
  useEffect(() => {
    setSearch(searchParams.get('q') ?? '')
  }, [searchParams])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(false)
    try {
      const [prods, cats] = await Promise.all([
        get<Product[]>(`/api/catalog?lang=${lang}`, token),
        get<Category[]>('/api/admin/categories', token),
      ])
      setProducts(prods ?? [])
      setCategories(cats ?? [])
      // Separately and non-fatally: a favourites outage should cost the stars,
      // not the whole catalogue.
      const generation = toggleGeneration.current
      get<FavoriteProduct[]>(`/api/favorites?lang=${lang}`, token)
        .then((favs) => {
          if (toggleGeneration.current !== generation) return
          setFavorites(new Set((favs ?? []).map((f) => f.productId)))
        })
        .catch(() => {
          if (toggleGeneration.current === generation) setFavorites(new Set())
        })
    } catch {
      // Surface a genuine fetch failure instead of showing an empty catalog,
      // which would look like "no products" during an outage.
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token, lang])

  useEffect(() => { load() }, [load])

  async function toggleFavorite(productId: number) {
    if (!token || favoriteBusy.has(productId)) return
    toggleGeneration.current += 1
    const wasFavorited = favorites.has(productId)

    // Optimistic: the star is the whole feedback, so waiting a round trip to
    // fill it in reads as a dead button.
    setFavorites((prev) => {
      const next = new Set(prev)
      if (wasFavorited) next.delete(productId)
      else next.add(productId)
      return next
    })
    setFavoriteBusy((prev) => new Set(prev).add(productId))

    try {
      if (wasFavorited) await del(`/api/favorites/${productId}`, token)
      else await put(`/api/favorites/${productId}`, {}, token)
    } catch {
      // Roll back rather than leave the star claiming something the server did
      // not record.
      setFavorites((prev) => {
        const next = new Set(prev)
        if (wasFavorited) next.add(productId)
        else next.delete(productId)
        return next
      })
    } finally {
      setFavoriteBusy((prev) => {
        const next = new Set(prev)
        next.delete(productId)
        return next
      })
    }
  }

  const categoryName = (categoryId: number) => categories.find((c) => c.id === categoryId)?.name

  const renderCard = (product: Product) => (
    <ProductCard
      key={product.id}
      id={product.id}
      name={product.name}
      description={product.description}
      imageAlt={product.imageAlt}
      categoryName={categoryName(product.categoryId)}
      favorited={favorites.has(product.id)}
      busy={favoriteBusy.has(product.id)}
      onToggleFavorite={() => toggleFavorite(product.id)}
      lang={lang}
    />
  )

  // Drawn from the loaded catalogue rather than from the /favorites payload, so a
  // favourite card is the same object as its counterpart in the grid below and
  // cannot drift out of sync with it.
  const favoriteProducts = products.filter((p) => favorites.has(p.id))

  const filtered = products.filter((p) => {
    const q = search.toLowerCase()
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    const matchesCat = selectedCategory === null || p.categoryId === selectedCategory
    return matchesSearch && matchesCat
  })

  return (
    <div className="flex gap-6">
      {/* Category sidebar */}
      <aside className="hidden md:block w-52 shrink-0">
        <div className="bg-white rounded-lg border border-slate-200 p-4 sticky top-28">
          <h3 className="font-bold text-xs text-slate-500 mb-3 uppercase tracking-wide">{t('categories', lang)}</h3>
          <ul className="space-y-1">
            <li>
              <button
                onClick={() => setSelectedCategory(null)}
                className="w-full text-left block px-3 py-1.5 rounded text-sm transition-colors font-semibold"
                style={selectedCategory === null ? { backgroundColor: 'var(--bp)', color: 'var(--bp-ink)' } : { color: '#475569' }}
                onMouseEnter={(e) => { if (selectedCategory !== null) (e.currentTarget as HTMLElement).style.backgroundColor = '#f1f5f9' }}
                onMouseLeave={(e) => { if (selectedCategory !== null) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
              >
                {t('allProducts', lang)}
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                  className="w-full text-left block px-3 py-1.5 rounded text-sm transition-colors"
                  style={selectedCategory === cat.id ? { backgroundColor: 'var(--bp)', color: 'var(--bp-ink)', fontWeight: 600 } : { color: '#475569' }}
                  onMouseEnter={(e) => { if (selectedCategory !== cat.id) (e.currentTarget as HTMLElement).style.backgroundColor = '#f1f5f9' }}
                  onMouseLeave={(e) => { if (selectedCategory !== cat.id) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Favourites shortcut. Hidden entirely when empty rather than shown as
            an empty shelf, and suppressed while searching or filtering so it
            cannot contradict the result set below it. */}
        {favoriteProducts.length > 0 && !search && selectedCategory === null && (
          <section className="mb-6" aria-labelledby="favorites-heading">
            <h2 id="favorites-heading" className="text-xl font-bold text-slate-800 mb-3">
              {t('myFavorites', lang)}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {favoriteProducts.map(renderCard)}
            </div>
          </section>
        )}

        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            {search ? (
              <h2 className="text-xl font-bold text-slate-800">
                {t('resultsFor', lang)}: <span style={{ color: 'var(--bp-text)' }}>&ldquo;{search}&rdquo;</span>
              </h2>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-800">{t('productCatalog', lang)}</h2>
                <p className="text-sm text-slate-500 mt-0.5">{t('productCatalogSubtitle', lang)}</p>
              </>
            )}
          </div>
          {filtered.length > 0 && (
            <span className="text-sm text-slate-500">{filtered.length} {t('products', lang)}</span>
          )}
        </div>

        {/* Mobile category pills */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 md:hidden">
            <button
              onClick={() => setSelectedCategory(null)}
              className="rounded-full px-3 py-1 text-sm font-medium transition-colors"
              style={selectedCategory === null ? { backgroundColor: 'var(--bp)', color: 'var(--bp-ink)' } : { backgroundColor: '#f1f5f9', color: '#475569' }}
            >
              {t('all', lang)}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                className="rounded-full px-3 py-1 text-sm font-medium transition-colors"
                style={selectedCategory === cat.id ? { backgroundColor: 'var(--bp)', color: 'var(--bp-ink)' } : { backgroundColor: '#f1f5f9', color: '#475569' }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="text-center py-20 bg-white rounded-lg border border-slate-200">
            <p className="font-semibold text-slate-700">{t('somethingWentWrong', lang)}</p>
            <button
              onClick={() => load()}
              className="text-sm mt-3 inline-block hover:underline"
              style={{ color: 'var(--bp-text)' }}
            >
              {t('tryAgain', lang)}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-lg border border-slate-200">
            <svg className="h-14 w-14 mx-auto mb-4 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="font-semibold text-slate-500">{t('noProducts', lang)}</p>
            {search && (
              <button onClick={() => setSearch('')} className="text-sm mt-2 inline-block hover:underline" style={{ color: 'var(--bp-text)' }}>
                ← {t('allProducts', lang)}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(renderCard)}
          </div>
        )}
      </div>
    </div>
  )
}
