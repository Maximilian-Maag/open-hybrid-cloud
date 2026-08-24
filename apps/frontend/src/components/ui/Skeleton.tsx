export function SkeletonCard() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col animate-pulse">
      <div className="h-40 bg-slate-100" />
      <div className="p-3 space-y-2">
        <div className="h-2 bg-slate-200 rounded w-1/3" />
        <div className="h-3 bg-slate-200 rounded w-4/5" />
        <div className="h-2 bg-slate-100 rounded w-2/3" />
        <div className="h-8 bg-slate-100 rounded mt-3" />
      </div>
    </div>
  )
}

export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-slate-200 rounded w-3/4" />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonListItem() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-slate-200" />
        <div className="space-y-1.5">
          <div className="h-3 bg-slate-200 rounded w-32" />
          <div className="h-2 bg-slate-100 rounded w-24" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="h-7 w-14 bg-slate-100 rounded-md" />
        <div className="h-7 w-14 bg-slate-100 rounded-md" />
      </div>
    </div>
  )
}
