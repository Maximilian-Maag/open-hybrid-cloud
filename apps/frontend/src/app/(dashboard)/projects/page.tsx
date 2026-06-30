import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Project } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Table } from '@/components/ui/Table'
import { NewProjectButton } from './NewProjectButton'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function ProjectsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  let projects: Project[] = []
  try {
    projects = (await get<Project[]>('/api/projects', token)) ?? []
  } catch {
    /* empty */
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('projects', lang)}
        subtitle={t('projectsSubtitle', lang)}
        actions={<NewProjectButton token={token} />}
      />

      <Table<Project>
        columns={[
          {
            header: t('name', lang),
            render: (row) => (
              <Link href={`/projects/${row.id}`} className="font-medium text-blue-600 hover:underline">
                {row.name}
              </Link>
            ),
          },
          { header: t('description', lang), accessor: 'description' },
          { header: t('owner', lang), accessor: 'ownerName' },
          {
            header: t('costCenter', lang),
            render: (row) => <span>{row.costCenterName ?? '—'}</span>,
          },
          {
            header: t('created', lang),
            render: (row) => (
              <span className="text-xs text-slate-500">
                {new Date(row.createdAt).toLocaleDateString()}
              </span>
            ),
          },
        ]}
        data={projects}
        emptyMessage={t('noProjects', lang)}
      />
    </div>
  )
}
