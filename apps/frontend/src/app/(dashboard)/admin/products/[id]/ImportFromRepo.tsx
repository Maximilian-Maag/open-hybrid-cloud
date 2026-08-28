'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { post } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Alert } from '@/components/ui/Alert'
import { Select } from '@/components/ui/Select'
import {
  TemplateSourceFields,
  emptyTemplateSource,
  templateSourceComplete,
  type TemplateSource,
} from '@/components/forms/TemplateSourceFields'
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
  offeredIn,
  lang,
}: {
  productId: number
  /**
   * EVERY deployment environment.
   *
   * This used to be only the ones the product was offered in, which left the
   * list empty on exactly the product that needs the import most — a new one,
   * with no offerings yet. The environment could not be chosen at all.
   */
  environments: { id: number; name: string }[]
  /**
   * Which of them the product is already offered in.
   *
   * Not a filter, a warning. A stack for an environment with no offering is
   * inert rather than wrong — it fires only for an order, and an order needs an
   * offering — so building the pipeline first is fine. Discovering the missing
   * offering at the till is not.
   */
  offeredIn: number[]
  lang: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // Where the template lives, in the shape the create form uses too.
  const [source, setSource] = useState<TemplateSource>(emptyTemplateSource)
  // Preselected when there is only one offering, because then there is no
  // decision to make and one fewer field to forget.
  const [environmentId, setEnvironmentId] = useState(
    environments.length === 1 ? String(environments[0].id) : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

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

  function openDialog() {
    setOutcome(null)
    setError(null)
    setOpen(true)
  }

  async function handleImport() {
    await withBusy(async () => {
      const result = await post<ImportOutcome>(`/api/admin/products/${productId}/import-parameters`, {
        ciSourceId: Number(source.ciSourceId),
        projectId: source.projectId,
        ref: source.ref,
        path: source.path,
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

  const ready = templateSourceComplete(source)

  return (
    <>
      <Button size="sm" variant="secondary" onClick={openDialog}>
        {t('importFromRepository', lang)}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('importFromRepository', lang)} size="lg">
        {open && (
          <div className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <p className="text-sm text-slate-600">{t('importFromRepositoryIntro', lang)}</p>

            <TemplateSourceFields value={source} onChange={setSource} onError={setError} lang={lang} />

            <Select
              label={t('environment', lang)}
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
              placeholder={t('selectEnvironment', lang)}
              options={environments.map((e) => ({ value: String(e.id), label: e.name }))}
              hint={t('importCreatesStackHint', lang)}
            />

            {environmentId !== '' && !offeredIn.includes(Number(environmentId)) && (
              <Alert tone="warning">{t('notOfferedHereYet', lang)}</Alert>
            )}

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
