import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function DashboardLoading() {
  const lang = await getLang()
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label={t('loading', lang)}>
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        <p className="text-sm text-slate-500">{t('loading', lang)}</p>
      </div>
    </div>
  )
}
