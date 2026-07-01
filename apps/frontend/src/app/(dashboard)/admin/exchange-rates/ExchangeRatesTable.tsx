'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ExchangeRate } from '@open-hybrid-cloud/types'
import { get, post } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'

interface Props { token: string }

export function ExchangeRatesTable({ token }: Props) {
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRates((await get<ExchangeRate[]>('/api/admin/exchange-rates', token)) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load exchange rates.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      await post('/api/admin/exchange-rates/refresh', {}, token)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh rates.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Card
      title="Exchange Rates"
      action={
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={refreshing || loading}>
          {refreshing ? 'Refreshing…' : 'Refresh Rates'}
        </Button>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        </div>
      ) : (
        <Table<ExchangeRate & { id: string }>
          columns={[
            {
              header: 'Currency',
              render: (row) => (
                <span className="font-mono font-semibold text-slate-900">{row.currencyCode}</span>
              ),
            },
            {
              header: 'Rate (to EUR)',
              render: (row) => (
                <span className="font-mono">{Number(row.rate).toFixed(6)}</span>
              ),
            },
            {
              header: 'Last Updated',
              render: (row) => (
                <span className="text-xs text-slate-500">
                  {new Date(row.updatedAt).toLocaleString()}
                </span>
              ),
            },
          ]}
          data={rates.map((r) => ({ ...r, id: r.currencyCode }))}
          emptyMessage="No exchange rates configured."
        />
      )}
    </Card>
  )
}
