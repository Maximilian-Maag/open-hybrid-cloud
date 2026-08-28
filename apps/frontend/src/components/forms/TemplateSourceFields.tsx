'use client'

import { useEffect, useState } from 'react'
import type { CiSource, CiProject, CiBranch } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { t } from '@/lib/i18n'

/**
 * Where a template lives: CI source, repository, branch, directory.
 *
 * Shared by the two places that ask for it — the import dialog on an existing
 * product, and the create form, which imports right after creating one. Four
 * dependent pickers with two API calls between them is not something to keep two
 * copies of: they drift, and the copy that drifts is the one nobody is looking
 * at.
 *
 * The PARENT owns the chosen coordinates and this owns the fetched lists. That
 * split is what lets the create form validate before submitting and the dialog
 * keep its own busy/error handling, without either having to know how a branch
 * list is loaded.
 */

export interface TemplateSource {
  ciSourceId: string
  projectId: string
  ref: string
  path: string
}

export const emptyTemplateSource = (): TemplateSource => ({
  ciSourceId: '', projectId: '', ref: '', path: '',
})

/** Everything the import endpoint insists on. The path may legitimately be ''. */
export const templateSourceComplete = (value: TemplateSource): boolean =>
  value.ciSourceId !== '' && value.projectId !== '' && value.ref !== ''

export function TemplateSourceFields({
  value,
  onChange,
  onError,
  lang,
  disabled = false,
}: {
  value: TemplateSource
  onChange: (next: TemplateSource) => void
  /** Reported upward so the caller shows it wherever it shows its other errors. */
  onError: (message: string | null) => void
  lang: string
  disabled?: boolean
}) {
  const [sources, setSources] = useState<CiSource[] | null>(null)
  const [projects, setProjects] = useState<CiProject[] | null>(null)
  const [branches, setBranches] = useState<CiBranch[] | null>(null)

  const load = async (work: () => Promise<void>) => {
    onError(null)
    try {
      await work()
    } catch (e) {
      onError(e instanceof Error ? e.message : t('unexpectedError', lang))
    }
  }

  // The source list is the one fetch with no prerequisite, so it happens on
  // mount rather than behind a click.
  useEffect(() => {
    void load(async () => setSources((await get<CiSource[]>('/api/admin/ci-sources')) ?? []))
    // Once. `load` closes over `onError`, which a parent may redefine per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Everything downstream of a changed field is stale, so it is cleared rather than left to mislead. */
  function pickSource(ciSourceId: string) {
    onChange({ ...value, ciSourceId, projectId: '', ref: '' })
    setProjects(null)
    setBranches(null)
    if (ciSourceId === '') return
    void load(async () =>
      setProjects((await get<CiProject[]>(`/api/admin/ci/${ciSourceId}/projects`)) ?? []),
    )
  }

  function pickProject(projectId: string) {
    onChange({ ...value, projectId, ref: '' })
    setBranches(null)
    if (projectId === '') return
    void load(async () =>
      setBranches(
        (await get<CiBranch[]>(
          `/api/admin/ci/${value.ciSourceId}/projects/${encodeURIComponent(projectId)}/branches`,
        )) ?? [],
      ),
    )
  }

  return (
    <>
      <Select
        label={t('ciSource', lang)}
        value={value.ciSourceId}
        onChange={(e) => pickSource(e.target.value)}
        disabled={disabled}
        placeholder={t('selectPlaceholder', lang)}
        options={(sources ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
      />

      <Select
        label={t('repository', lang)}
        value={value.projectId}
        onChange={(e) => pickProject(e.target.value)}
        disabled={disabled || value.ciSourceId === '' || projects === null}
        placeholder={t('selectPlaceholder', lang)}
        options={(projects ?? []).map((p) => ({ value: p.id, label: p.fullPath }))}
      />

      <Select
        label={t('branch', lang)}
        value={value.ref}
        onChange={(e) => onChange({ ...value, ref: e.target.value })}
        disabled={disabled || value.projectId === '' || branches === null}
        placeholder={t('selectPlaceholder', lang)}
        options={(branches ?? []).map((b) => ({ value: b.name, label: b.name }))}
      />

      {/* A repository path, the same in every language — see the template
          repository's own layout, e.g. templates/linode/virtual-machine. */}
      <Input
        label={t('templatePath', lang)}
        value={value.path}
        onChange={(e) => onChange({ ...value, path: e.target.value })}
        disabled={disabled}
        placeholder="templates/linode/virtual-machine"
        hint={t('templatePathHint', lang)}
      />
    </>
  )
}
