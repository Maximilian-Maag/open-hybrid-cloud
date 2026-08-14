import type { ReactNode } from 'react'

interface Column<T> {
  header: string
  accessor?: keyof T
  render?: (row: T) => ReactNode
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  /**
   * Mouse-only convenience: makes the whole row clickable in addition to
   * whatever it already contains. It deliberately does NOT add role/tabIndex —
   * `role="button"` on a <tr> takes the row out of the table's accessibility
   * tree and costs screen-reader users grid navigation.
   *
   * So this must never be the ONLY way to reach a destination. Put a real
   * <Link> or <Button> in one of the cells and let this widen its hit area
   * (see the projects table). Table.test.tsx locks the plain semantics in.
   */
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

export function Table<T extends { id?: number | string }>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No data found.',
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                scope="col"
                className={`px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={row.id ?? i}
                {...(onRowClick && { onClick: () => onRowClick(row) })}
                className={`${i % 2 === 1 ? 'bg-slate-50/50' : ''} ${onRowClick ? 'cursor-pointer hover:bg-slate-100' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.header} className={`px-4 py-3 text-slate-700 ${col.className ?? ''}`}>
                    {col.render
                      ? col.render(row)
                      : col.accessor
                        ? String(row[col.accessor] ?? '')
                        : null}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
