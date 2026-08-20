import { t } from '@/lib/i18n'

/**
 * Marks an order as a time-boxed trial (issue #1).
 *
 * Worth its own badge in the approval queue in particular: it changes what the
 * approver is agreeing to — the deployment is torn down again shortly after it
 * comes up, and the pipeline is asked for elevated rights inside it.
 */
export function TrialBadge({ lang = 'en', minutes }: { lang?: string; minutes?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {t('trial', lang)}
      {minutes !== undefined && ` · ${minutes} ${t('trialMinutes', lang)}`}
    </span>
  )
}
