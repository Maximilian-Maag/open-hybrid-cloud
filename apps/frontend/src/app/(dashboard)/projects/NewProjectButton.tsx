'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CostCenter, CreateProjectRequest } from '@open-hybrid-cloud/types'
import { post, get } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

export function NewProjectButton() {
  const router = useRouter()
  const lang = useLang()
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
      const ccs = await get<CostCenter[]>('/api/admin/cost-centers')
      setCostCenters(ccs?.filter((c) => c.active) ?? [])
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError(t('nameRequired', lang)); return }
    setLoading(true)
    setError(null)
    try {
      const body: CreateProjectRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        costCenterId: costCenterId ? Number(costCenterId) : undefined,
      }
      await post('/api/projects', body)
      setOpen(false)
      setName(''); setDescription(''); setCostCenterId('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToCreate', lang))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button onClick={openModal}>{t('newProject', lang)}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('newProject', lang)} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert>{error}</Alert>
          )}
          <Input label={t('name', lang)} value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label htmlFor="new-project-description" className="text-sm font-medium text-slate-700">{t('description', lang)}</label>
            <textarea
              id="new-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {costCenters.length > 0 && (
            <Select
              label={t('costCenter', lang)}
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              placeholder="None"
              options={costCenters.map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.name}` }))}
            />
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('cancel', lang)}</Button>
            <Button type="submit" disabled={loading}>{loading ? t('creating', lang) : t('createProject', lang)}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
