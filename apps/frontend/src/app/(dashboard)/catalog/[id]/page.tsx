import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { cookies, headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import type { ProductDetail, Project, CostCenter, ExchangeRate } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { OrderForm } from '@/components/forms/OrderForm'
import { t, isValidLang } from '@/lib/i18n'
import { localeToCurrency, convertPrice } from '@/lib/locale'

interface Props {
  params: Promise<{ id: string }>
}

async function detectLang(): Promise<string> {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('lang')?.value
  if (langCookie && isValidLang(langCookie)) return langCookie
  const hdrs = await headers()
  const acceptLang = hdrs.get('accept-language') ?? ''
  const code = acceptLang.split(',')[0]?.split(';')[0]?.trim().split('-')[0].toLowerCase() ?? 'en'
  if (isValidLang(code)) return code
  return 'en'
}

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await detectLang()
  const localeCurrency = localeToCurrency(lang)

  const [productRes, projectsRes, costCentersRes, ratesRes] = await Promise.allSettled([
    get<ProductDetail>(`/api/catalog/${id}?lang=${lang}`, token),
    get<Project[]>('/api/projects', token),
    get<CostCenter[]>('/api/admin/cost-centers', token),
    get<ExchangeRate[]>('/api/admin/exchange-rates', token),
  ])

  if (productRes.status === 'rejected') notFound()
  const product = productRes.value
  const projects = projectsRes.status === 'fulfilled' ? (projectsRes.value ?? []) : []
  const costCenters = costCentersRes.status === 'fulfilled' ? (costCentersRes.value ?? []) : []

  const ratesMap: Record<string, number> =
    ratesRes.status === 'fulfilled'
      ? Object.fromEntries((ratesRes.value ?? []).map((r) => [r.currencyCode, parseFloat(r.rate)]))
      : {}

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title={product.name} />

      <Card>
        <p className="text-slate-600 leading-relaxed">{product.description}</p>

        {product.environments.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">{t('availableEnvironments', lang)}</h3>
            <div className="flex flex-wrap gap-2">
              {product.environments.map((env) => {
                const converted = convertPrice(env.price, env.currency, localeCurrency, ratesMap)
                const showConverted = converted.currency !== env.currency
                return (
                  <div
                    key={env.environmentId}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600"
                  >
                    {env.environmentName ?? `Env ${env.environmentId}`} —{' '}
                    {showConverted
                      ? `${converted.amount} ${converted.currency}`
                      : `${env.price} ${env.currency}`}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      <Card title={t('placeOrder', lang)}>
        <OrderForm
          product={product}
          projects={projects}
          costCenters={costCenters}
          token={token}
          lang={lang}
          exchangeRates={ratesMap}
          localeCurrency={localeCurrency}
        />
      </Card>
    </div>
  )
}
