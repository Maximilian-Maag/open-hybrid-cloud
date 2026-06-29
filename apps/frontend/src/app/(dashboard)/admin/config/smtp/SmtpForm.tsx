'use client'

import { useState } from 'react'
import type { SmtpConfig, UpdateSmtpRequest } from '@open-hybrid-cloud/types'
import { put } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

interface Props {
  initial: SmtpConfig | null
  token: string
}

export function SmtpForm({ initial, token }: Props) {
  const { toast } = useToast()
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? '587'))
  const [from, setFrom] = useState(initial?.from ?? '')
  const [user, setUser] = useState(initial?.user ?? '')
  const [password, setPassword] = useState('')
  const [tls, setTls] = useState(initial?.tls ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const body: UpdateSmtpRequest = {
        host: host.trim(), port: Number(port),
        from: from.trim(), user: user.trim(),
        tls,
        ...(password ? { password } : {}),
      }
      await put('/api/admin/config/smtp', body, token)
      toast('SMTP configuration saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save SMTP config.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="SMTP Settings">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Input label="Host" value={host} onChange={(e) => setHost(e.target.value)} required placeholder="smtp.example.com" />
          </div>
          <Input label="Port" type="number" value={port} onChange={(e) => setPort(e.target.value)} required />
        </div>

        <Input label="From Address" type="email" value={from} onChange={(e) => setFrom(e.target.value)} required placeholder="noreply@example.com" />
        <Input label="Username" value={user} onChange={(e) => setUser(e.target.value)} />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          hint={initial ? 'Leave blank to keep existing password' : undefined} />

        <div className="flex items-center gap-2">
          <input type="checkbox" id="tls" checked={tls} onChange={(e) => setTls(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          <label htmlFor="tls" className="text-sm font-medium text-slate-700">Use TLS</label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
        </div>
      </form>
    </Card>
  )
}
