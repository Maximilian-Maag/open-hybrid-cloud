import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'

const adminSections = [
  { href: '/admin/categories', title: 'Categories', description: 'Manage product categories' },
  { href: '/admin/products', title: 'Products', description: 'Manage catalog products' },
  { href: '/admin/environments', title: 'Environments', description: 'Configure deployment environments' },
  { href: '/admin/ci-sources', title: 'CI Sources', description: 'Configure CI/CD integrations' },
  { href: '/admin/cost-centers', title: 'Cost Centers', description: 'Manage cost center assignments' },
  { href: '/admin/users', title: 'Users', description: 'Manage user accounts and roles' },
  { href: '/admin/parameters', title: 'Global Parameters', description: 'Shared parameter definitions' },
  { href: '/admin/branding', title: 'Branding', description: 'Customize portal appearance' },
  { href: '/admin/config/smtp', title: 'SMTP Config', description: 'Email server configuration' },
  { href: '/admin/config/ai', title: 'AI Config', description: 'AI provider settings' },
  { href: '/admin/exchange-rates', title: 'Exchange Rates', description: 'Currency exchange rates' },
]

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/')

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title="Admin Dashboard" subtitle="Manage system configuration and settings." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adminSections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
          >
            <h3 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors mb-1">
              {section.title}
            </h3>
            <p className="text-sm text-slate-500">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
