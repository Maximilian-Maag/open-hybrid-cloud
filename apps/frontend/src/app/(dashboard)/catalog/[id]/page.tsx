import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import type { ProductDetail, Project, CostCenter, ExchangeRate, Category } from '@open-hybrid-cloud/types'
import { Card } from '@/components/ui/Card'
import { OrderForm } from '@/components/forms/OrderForm'
import { AddToCart } from './AddToCart'
import { ProductImage } from '@/components/ui/ProductImage'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'
import { localeToCurrency, convertPrice } from '@/lib/locale'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** First value only — a repeated key has no meaningful "both". */
const one = (raw: string | string[] | undefined): string | undefined =>
  Array.isArray(raw) ? raw[0] : raw

/**
 * Product detail, laid out the way a shopper expects a shop to be laid out:
 * picture on the left, what it is in the middle, and the buy box — price, what it
 * costs where, and the two calls to action — pinned on the right. The ordering
 * form itself sits below, because it asks for parameters and a project and that is
 * a form, not a buy box.
 */
export default async function ProductDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const query = await searchParams
  // Quick reorder from the infrastructure list (issue #39).
  const fromInfraId = one(query.fromInfra)
  const initialProjectId = one(query.projectId)
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()
  const localeCurrency = localeToCurrency(lang)

  const [productRes, projectsRes, costCentersRes, ratesRes, categoriesRes] = await Promise.allSettled([
    get<ProductDetail>(`/api/catalog/${id}?lang=${lang}`, token),
    get<Project[]>('/api/projects', token),
    get<CostCenter[]>('/api/admin/cost-centers', token),
    get<ExchangeRate[]>('/api/admin/exchange-rates', token),
    get<Category[]>('/api/admin/categories', token),
  ])

  if (productRes.status === 'rejected') notFound()
  const product = productRes.value
  const projects = projectsRes.status === 'fulfilled' ? (projectsRes.value ?? []) : []
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []
  const categories = categoriesRes.status === 'fulfilled' ? (categoriesRes.value ?? []) : []
  const categoryName = categories.find((c) => c.id === product.categoryId)?.name

  const ratesMap: Record<string, number> =
    ratesRes.status === 'fulfilled'
      ? Object.fromEntries((ratesRes.value ?? []).map((r) => [r.currencyCode, parseFloat(r.rate)]))
      : {}

  /** An offering's price in the viewer's currency, with the original alongside. */
  const priceOf = (env: { price: string; currency: string }) => {
    const converted = convertPrice(env.price, env.currency, localeCurrency, ratesMap, lang)
    return {
      display: `${converted.amount} ${converted.currency}`,
      original: converted.currency !== env.currency ? `${env.price} ${env.currency}` : null,
    }
  }

  // The buy box leads with the cheapest offering, because that is the number a
  // shopper reads as "the price" — the full list is right below it.
  const cheapest = [...product.environments].sort(
    (a, b) => Number(a.price) - Number(b.price),
  )[0]

  return (
    <div className="max-w-screen-xl mx-auto">
      <nav aria-label={t('catalog', lang)} className="mb-3 text-xs text-slate-500">
        <Link href="/catalog" className="hover:underline" style={{ color: 'var(--bp-text)' }}>
          {t('catalog', lang)}
        </Link>
        {categoryName && <> <span aria-hidden="true">›</span> {categoryName}</>}
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Picture */}
        <div className="lg:col-span-4">
          <div className="h-72 rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-28">
            <ProductImage productId={product.id} name={product.name} />
          </div>
        </div>

        {/* What it is */}
        <div className="lg:col-span-5">
          <h1 className="text-2xl font-bold text-slate-900">{product.name}</h1>
          {categoryName && (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--bp-text)' }}>
              {categoryName}
            </p>
          )}
          <hr className="my-4 border-slate-200" />
          <p className="leading-relaxed text-slate-600">{product.description}</p>

          {product.environments.length > 0 && (
            <>
              <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-700">
                {t('availableEnvironments', lang)}
              </h2>
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {product.environments.map((env) => {
                  const price = priceOf(env)
                  return (
                    <li key={env.environmentId} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <span className="text-sm text-slate-700">
                        {env.environmentName ?? `Env ${env.environmentId}`}
                      </span>
                      <span className="text-sm font-medium text-slate-900">
                        {price.display}
                        {price.original && (
                          <span className="ml-2 text-xs font-normal text-slate-500">({price.original})</span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {/* Buy box. Omitted outright when the product is offered nowhere: a price
            box with no price and no working button is worse than none. */}
        {cheapest && (
          <div className="lg:col-span-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-28">
              <p className="text-2xl font-bold text-slate-900">{priceOf(cheapest).display}</p>
              {product.environments.length > 1 && (
                <p className="mt-1 text-xs text-slate-500">
                  {cheapest.environmentName ?? `Env ${cheapest.environmentId}`}
                </p>
              )}
              <div className="mt-4 space-y-3">
                {/* Environment plus one click, and nothing else: parameters are
                    what checkout is for (issue #28). */}
                <AddToCart product={product} token={token} lang={lang} />
                {/* Styled as a link, not a Button inside a Link: nested
                    interactives fail the axe gate in e2e/a11y.spec.ts. Outlined
                    rather than filled — it is the second action, and it only jumps
                    to the form below. */}
                <a
                  href="#order"
                  className="block w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {t('orderNow', lang)}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* The form proper, linked from the buy box above. */}
      <div id="order" className="mt-8 max-w-3xl scroll-mt-28">
        <Card title={t('placeOrder', lang)}>
          <OrderForm
            product={product}
            projects={projects}
            costCenters={costCenters}
            token={token}
            lang={lang}
            exchangeRates={ratesMap}
            localeCurrency={localeCurrency}
            fromInfraId={fromInfraId}
            initialProjectId={initialProjectId}
          />
        </Card>
      </div>
    </div>
  )
}
