'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CiSource, CiProject, CiBranch } from '@open-hybrid-cloud/types'
import { get, post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Alert } from '@/components/ui/Alert'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { t } from '@/lib/i18n'

type StackOutcome =
  | { created: true; name: string; stateKeyParam: string; template: string }
  | { created: false; reason: 'already-configured'; name: string }
  | { created: false; reason: 'no-template-path' }

interface ImportOutcome {
  created: number
  skipped: number
  createdNames: string[]
  skippedModules: { module: string; source: string; reason: string }[]
  filesRead: string[]
  stack?: StackOutcome
}

/**
 * Import a product's parameters straight from a repository path.
 *
 * The sibling "Sync from template" derives the repository, the ref and the path
 * from a pipeline stack, so it cannot run before one exists — which is precisely
 * while a product is being set up — and it always reads `main`.
 *
 * The browse endpoints this uses have existed since the CI sources admin was
 * built and nothing ever called them: the capability was missing from the
 * interface, not from the backend.
 */
export function ImportFromRepo({
  productId,
  environments,
  lang,
}: {
  productId: number
  /** The environments this product is OFFERED in — the stack goes in one of them. */
  environments: { id: number; name: string }[]
  lang: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<CiSource[] | null>(null)
  const [projects, setProjects] = useState<CiProject[] | null>(null)
  const [branches, setBranches] = useState<CiBranch[] | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [ref, setRef] = useState('')
  const [path, setPath] = useState('')
  // Preselected when there is only one offering, because then there is no
  // decision to make and one fewer field to forget.
  const [environmentId, setEnvironmentId] = useState(
    environments.length === 1 ? String(environments[0].id) : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  /** Everything downstream of a changed field is stale, so it is cleared rather than left to mislead. */
  function pickSource(value: string) {
    setSourceId(value)
    setProjectId('')
    setRef('')
    setProjects(null)
    setBranches(null)
    if (value === '') return
    void withBusy(async () => setProjects(await get<CiProject[]>(`/api/admin/ci/${value}/projects`) ?? []))
  }

  function pickProject(value: string) {
    setProjectId(value)
    setRef('')
    setBranches(null)
    if (value === '') return
    void withBusy(async () =>
      setBranches(await get<CiBranch[]>(`/api/admin/ci/${sourceId}/projects/${encodeURIComponent(value)}/branches`) ?? []),
    )
  }

  async function withBusy(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unexpectedError', lang))
    } finally {
      setBusy(false)
    }
  }

  async function openDialog() {
    setOutcome(null)
    setError(null)
    setOpen(true)
    if (sources === null) {
      await withBusy(async () => setSources(await get<CiSource[]>('/api/admin/ci-sources') ?? []))
    }
  }

  async function handleImport() {
    await withBusy(async () => {
      const result = await post<ImportOutcome>(`/api/admin/products/${productId}/import-parameters`, {
        ciSourceId: Number(sourceId),
        projectId,
        ref,
        path,
        // Given one, the import also creates the pipeline stack. Without a stack
        // (or a webhook) the product has nothing to provision it and ordering
        // fails at the till — which is how an imported Kubernetes product came
        // to be unorderable.
        ...(environmentId !== '' ? { environmentId: Number(environmentId) } : {}),
      })
      setOutcome(result)
      // The list on the page behind the dialog is server-rendered.
      router.refresh()
    })
  }

  const ready = sourceId !== '' && projectId !== '' && ref !== ''

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => void openDialog()}>
        {t('importFromRepository', lang)}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('importFromRepository', lang)} size="lg">
        {open && (
          <div className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <p className="text-sm text-slate-600">{t('importFromRepositoryIntro', lang)}</p>

            <Select
              label={t('ciSource', lang)}
              value={sourceId}
              onChange={(e) => pickSource(e.target.value)}
              placeholder={t('selectPlaceholder', lang)}
              options={(sources ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
            />

            <Select
              label={t('repository', lang)}
              value={projectId}
              onChange={(e) => pickProject(e.target.value)}
              disabled={sourceId === '' || projects === null}
              placeholder={t('selectPlaceholder', lang)}
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.fullPath }))}
            />

            <Select
              label={t('branch', lang)}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              disabled={projectId === '' || branches === null}
              placeholder={t('selectPlaceholder', lang)}
              options={(branches ?? []).map((b) => ({ value: b.name, label: b.name }))}
            />

            <Select
              label={t('environment', lang)}
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
              placeholder={t('selectEnvironment', lang)}
              options={environments.map((e) => ({ value: String(e.id), label: e.name }))}
              hint={t('importCreatesStackHint', lang)}
            />

            {/* A repository path, the same in every language — see the template
                repository's own layout, e.g. templates/linode/virtual-machine. */}
            <Input
              label={t('templatePath', lang)}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="templates/linode/virtual-machine"
              hint={t('templatePathHint', lang)}
            />

            {outcome && (
              <Alert tone={outcome.created > 0 ? 'success' : 'warning'}>
                <span className="block">
                  {outcome.created > 0
                    ? `${t('parametersImported', lang)}: ${outcome.created}${outcome.skipped > 0 ? ` · ${t('alreadyExisted', lang)}: ${outcome.skipped}` : ''}`
                    : t('importedNothing', lang)}
                </span>
                {outcome.createdNames.length > 0 && (
                  <span className="block text-xs mt-1">{outcome.createdNames.join(', ')}</span>
                )}
                {/* Which files were read is how an operator tells a wrong path
                    from a template that genuinely declares nothing. */}
                {outcome.filesRead.length > 0 && (
                  <span className="block text-xs mt-1 text-slate-600">
                    {t('filesRead', lang)}: {outcome.filesRead.join(', ')}
                  </span>
                )}
                {/* The stack is what makes the product orderable, so it is
                    reported as plainly as the parameters are. */}
                {outcome.stack?.created === true && (
                  <span className="block text-xs mt-1">
                    {t('pipelineStackCreated', lang)}: <span className="font-mono">{outcome.stack.template}</span>
                    {' · '}
                    {t('stateKeyShort', lang)}: <span className="font-mono">{outcome.stack.stateKeyParam}</span>
                  </span>
                )}
                {outcome.stack?.created === false && outcome.stack.reason === 'already-configured' && (
                  <span className="block text-xs mt-1 text-slate-600">
                    {t('pipelineStackKept', lang)}: <span className="font-mono">{outcome.stack.name}</span>
                  </span>
                )}
                {outcome.skippedModules.length > 0 && (
                  <span className="block text-xs mt-1">
                    {t('modulesNotRead', lang)}{' '}
                    {outcome.skippedModules.map((m) => `${m.module || m.source} (${m.reason})`).join('; ')}
                  </span>
                )}
              </Alert>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t('close', lang)}</Button>
          <Button disabled={busy || !ready} aria-busy={busy} onClick={() => void handleImport()}>
            {busy ? t('importing', lang) : t('importParameters', lang)}
          </Button>
        </div>
      </Modal>
    </>
  )
}
