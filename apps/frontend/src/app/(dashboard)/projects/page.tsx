import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Project } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Table } from '@/components/ui/Table'
import { NewProjectButton } from './NewProjectButton'

export default async function ProjectsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken

  let projects: Project[] = []
  try {
    projects = (await get<Project[]>('/api/projects', token)) ?? []
  } catch {
    /* empty */
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Projects"
        subtitle="Manage your infrastructure projects."
        actions={<NewProjectButton token={token} />}
      />

      <Table<Project>
        columns={[
          {
            header: 'Name',
            render: (row) => (
              <Link href={`/projects/${row.id}`} className="font-medium text-blue-600 hover:underline">
                {row.name}
              </Link>
            ),
          },
          { header: 'Description', accessor: 'description' },
          { header: 'Owner', accessor: 'ownerName' },
          {
            header: 'Cost Center',
            render: (row) => <span>{row.costCenterName ?? '—'}</span>,
          },
          {
            header: 'Created',
            render: (row) => (
              <span className="text-xs text-slate-500">
                {new Date(row.createdAt).toLocaleDateString()}
              </span>
            ),
          },
        ]}
        data={projects}
        emptyMessage="No projects yet."
      />
    </div>
  )
}
