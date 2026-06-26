import type { OrderStatus, InfraStatus } from '@open-hybrid-cloud/types'

type Status = OrderStatus | InfraStatus

const colorMap: Record<Status, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  provisioning: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
  rejected: 'bg-slate-100 text-slate-600 border-slate-200',
  active: 'bg-green-100 text-green-800 border-green-200',
  decommissioning: 'bg-orange-100 text-orange-800 border-orange-200',
  decommissioned: 'bg-slate-100 text-slate-600 border-slate-200',
}

const labelMap: Record<Status, string> = {
  pending: 'Pending',
  provisioning: 'Provisioning',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  active: 'Active',
  decommissioning: 'Decommissioning',
  decommissioned: 'Decommissioned',
}

export function StatusBadge({ status }: { status: Status }) {
  const color = colorMap[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  const label = labelMap[status] ?? status
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  )
}
