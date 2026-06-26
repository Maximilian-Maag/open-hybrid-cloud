'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CostCenter, CreateProjectRequest } from '@open-hybrid-cloud/types'
import { post, get } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

interface Props {
  token: string
}

export function NewProjectButton({ token }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openModal() {
    setOpen(true)
    try {
      const ccs = await get<CostCenter[]>('/api/admin/cost-centers', token)
      setCostCenters(ccs?.filter((c) => c.active) ?? [])
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setLoading(true)
    setError(null)
    try {
      const body: CreateProjectRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        costCenterId: costCenterId ? Number(costCenterId) : undefined,
      }
      await post('/api/projects', body, token)
      setOpen(false)
      setName(''); setDescription(''); setCostCenterId('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button onClick={openModal}>New Project</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New Project" size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {costCenters.length > 0 && (
            <Select
              label="Cost Center"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              placeholder="None"
              options={costCenters.map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.name}` }))}
            />
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create Project'}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
