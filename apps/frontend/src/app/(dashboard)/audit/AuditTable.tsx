'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AuditEntry, PaginatedResponse } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { Table } from '@/components/ui/Table'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface Props {
  token: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function AuditTable({ token }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [userFilter, setUserFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  const pageSize = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (userFilter) params.set('userId', userFilter)
      if (actionFilter) params.set('action', actionFilter)
      if (fromFilter) params.set('from', fromFilter)
      if (toFilter) params.set('to', toFilter)

      const result = await get<PaginatedResponse<AuditEntry> | AuditEntry[]>(
        `/api/audit?${params.toString()}`,
        token,
      )
      if (Array.isArray(result)) {
        setEntries(result)
        setTotal(result.length)
      } else {
        setEntries(result.data ?? [])
        setTotal(result.total ?? 0)
      }
    } catch {
      /* empty */
    } finally {
      setLoading(false)
    }
  }, [token, page, userFilter, actionFilter, fromFilter, toFilter])

  useEffect(() => { load() }, [load])

  function handleExport(format: 'csv' | 'pdf') {
    const params = new URLSearchParams()
    if (userFilter) params.set('userId', userFilter)
    if (actionFilter) params.set('action', actionFilter)
    if (fromFilter) params.set('from', fromFilter)
    if (toFilter) params.set('to', toFilter)
    params.set('format', format)
    window.open(`${API_URL}/api/audit/export?${params.toString()}&token=${token}`, '_blank')
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Input
          label="User ID"
          type="number"
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(1) }}
          placeholder="Any"
        />
        <Input
          label="Action"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
          placeholder="Any"
        />
        <Input
          label="From"
          type="date"
          value={fromFilter}
          onChange={(e) => { setFromFilter(e.target.value); setPage(1) }}
        />
        <Input
          label="To"
          type="date"
          value={toFilter}
          onChange={(e) => { setToFilter(e.target.value); setPage(1) }}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => handleExport('csv')}>
          Export CSV
        </Button>
        <Button variant="secondary" size="sm" onClick={() => handleExport('pdf')}>
          Export PDF
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        </div>
      ) : (
        <Table<AuditEntry>
          columns={[
            { header: 'ID', accessor: 'id', className: 'w-16' },
            {
              header: 'User',
              render: (row) => <span>{row.userName ?? (row.userId ? `#${row.userId}` : 'System')}</span>,
            },
            { header: 'Action', accessor: 'action' },
            {
              header: 'Entity',
              render: (row) => <span>{row.entityId ?? '—'}</span>,
            },
            { header: 'Details', accessor: 'details', className: 'max-w-xs truncate' },
            {
              header: 'Date',
              render: (row) => (
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
              ),
            },
          ]}
          data={entries}
          emptyMessage="No audit entries found."
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages} ({total} entries)
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
