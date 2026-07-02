'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Project, CostCenter, UpdateProjectRequest } from '@open-hybrid-cloud/types'
import { put, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface Props {
  project: Project
  costCenters: CostCenter[]
  token: string
}

export function ProjectEditForm({ project, costCenters, token }: Props) {
  const router = useRouter()
  const lang = useLang()
  const { toast } = useToast()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [costCenterId, setCostCenterId] = useState(project.costCenterId ? String(project.costCenterId) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const body: UpdateProjectRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        costCenterId: costCenterId ? Number(costCenterId) : undefined,
      }
      await put(`/api/projects/${project.id}`, body, token)
      toast(t('projectSaved', lang))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSave', lang))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await del(`/api/projects/${project.id}`, token)
      router.push('/projects')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToDelete', lang))
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  return (
    <>
      <Card
        title={t('projectDetails', lang)}
        action={
          <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
            {t('delete', lang)}
          </Button>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          <Input label={t('name', lang)} value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex flex-col gap-1">
            <label htmlFor="project-description" className="text-sm font-medium text-slate-700">{t('description', lang)}</label>
            <textarea
              id="project-description"
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
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>{saving ? t('saving', lang) : t('saveChanges', lang)}</Button>
          </div>
        </form>
      </Card>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('deleteProject', lang)} size="sm">
        <p className="text-sm text-slate-600 mb-6">
          {t('areYouSureDelete', lang)} <strong>{project.name}</strong>? {t('cannotBeUndone', lang)}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t('cancel', lang)}</Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? t('deleting', lang) : t('delete', lang)}
          </Button>
        </div>
      </Modal>
    </>
  )
}
