'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import type { Product, Category } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useLang } from '@/lib/useLang'

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

  // sync URL search param into local state
  useEffect(() => {
    setSearch(searchParams.get('q') ?? '')
  }, [searchParams])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [prods, cats] = await Promise.all([
        get<Product[]>(`/api/catalog?lang=${lang}`, token),
        get<Category[]>('/api/admin/categories', token),
      ])
      setProducts(prods ?? [])
      setCategories(cats ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [token, lang])

  useEffect(() => { load() }, [load])

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
          <h3 className="font-bold text-xs text-slate-500 mb-3 uppercase tracking-wide">Categories</h3>
          <ul className="space-y-1">
            <li>
              <button
                onClick={() => setSelectedCategory(null)}
                className="w-full text-left block px-3 py-1.5 rounded text-sm transition-colors font-semibold"
                style={selectedCategory === null ? { backgroundColor: 'var(--bp)', color: '#fff' } : { color: '#475569' }}
                onMouseEnter={(e) => { if (selectedCategory !== null) (e.currentTarget as HTMLElement).style.backgroundColor = '#f1f5f9' }}
                onMouseLeave={(e) => { if (selectedCategory !== null) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
              >
                All products
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                  className="w-full text-left block px-3 py-1.5 rounded text-sm transition-colors"
                  style={selectedCategory === cat.id ? { backgroundColor: 'var(--bp)', color: '#fff', fontWeight: 600 } : { color: '#475569' }}
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
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            {search ? (
              <h2 className="text-xl font-bold text-slate-800">
                Results for: <span style={{ color: 'var(--bp)' }}>&ldquo;{search}&rdquo;</span>
              </h2>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-800">{t('productCatalog', lang)}</h2>
                <p className="text-sm text-slate-500 mt-0.5">{t('productCatalogSubtitle', lang)}</p>
              </>
            )}
          </div>
          {filtered.length > 0 && (
            <span className="text-sm text-slate-400">{filtered.length} products</span>
          )}
        </div>

        {/* Mobile category pills */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 md:hidden">
            <button
              onClick={() => setSelectedCategory(null)}
              className="rounded-full px-3 py-1 text-sm font-medium transition-colors"
              style={selectedCategory === null ? { backgroundColor: 'var(--bp)', color: '#fff' } : { backgroundColor: '#f1f5f9', color: '#475569' }}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                className="rounded-full px-3 py-1 text-sm font-medium transition-colors"
                style={selectedCategory === cat.id ? { backgroundColor: 'var(--bp)', color: '#fff' } : { backgroundColor: '#f1f5f9', color: '#475569' }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-lg border border-slate-200">
            <svg className="h-14 w-14 mx-auto mb-4 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="font-semibold text-slate-400">{t('noProducts', lang)}</p>
            {search && (
              <button onClick={() => setSearch('')} className="text-sm mt-2 inline-block hover:underline" style={{ color: 'var(--bp)' }}>
                ← All products
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((product) => {
              const catName = categories.find((c) => c.id === product.categoryId)?.name
              return (
                <div
                  key={product.id}
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col hover:shadow-md transition-all"
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--bp)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
                >
                  <div
                    className="h-40 flex items-center justify-center border-b border-slate-100"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bp) 8%, white)' }}
                  >
                    <svg className="h-14 w-14 opacity-25" style={{ color: 'var(--bp)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                    </svg>
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    {catName && (
                      <span className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--bp)' }}>
                        {catName}
                      </span>
                    )}
                    <h3 className="font-semibold text-sm text-slate-800 leading-snug mb-1 line-clamp-2">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-xs text-slate-500 leading-relaxed flex-1 mb-3 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    <Link
                      href={`/catalog/${product.id}`}
                      className="w-full py-2 px-3 rounded text-center text-sm font-semibold block text-gray-900 hover:brightness-95 transition-all"
                      style={{ backgroundColor: 'var(--bs)' }}
                    >
                      {t('placeOrder', lang)}
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
