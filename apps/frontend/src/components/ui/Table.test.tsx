import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Table } from './Table'

interface Row { id: number; name: string }
const columns = [{ header: 'Name', accessor: 'name' as const }]
// Required even where no row is missing, because the component cannot translate
// a default of its own: it has no `lang`, and the English one it used to carry
// was the message 24 of 25 languages got (#186).
const empty = 'Nothing here'

describe('Table', () => {
  it('renders column headers with scope="col"', () => {
    render(<Table<Row> columns={columns} data={[{ id: 1, name: 'Alpha' }]} emptyMessage={empty} />)
    const th = screen.getByText('Name')
    expect(th.tagName).toBe('TH')
    expect(th).toHaveAttribute('scope', 'col')
  })

  it('renders a column with no header as a td, not an empty th', () => {
    // An empty <th> is a header cell that announces nothing — axe's
    // `empty-table-header` — and the row-actions column is the one column here
    // that genuinely has no name. A <td> in the header row says that instead of
    // claiming a heading and then not providing one.
    render(
      <Table<Row>
        columns={[...columns, { header: '', render: () => <button type="button">Edit</button> }]}
        data={[{ id: 1, name: 'Alpha' }]}
        emptyMessage={empty}
      />,
    )
    const cells = document.querySelectorAll('thead tr > *')
    expect(Array.from(cells).map((c) => c.tagName)).toEqual(['TH', 'TD'])
    // And no header cell is left without a name, which is the property that matters.
    expect(Array.from(document.querySelectorAll('th')).every((th) => th.textContent?.trim())).toBe(true)
  })

  it('renders the empty message when there is no data', () => {
    render(<Table<Row> columns={columns} data={[]} emptyMessage={empty} />)
    expect(screen.getByText(empty)).toBeInTheDocument()
  })

  it('fires onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn()
    render(
      <Table<Row>
        columns={columns}
        data={[{ id: 1, name: 'Alpha' }]}
        emptyMessage={empty}
        onRowClick={onRowClick}
      />,
    )
    const row = screen.getByText('Alpha').closest('tr')
    if (!row) throw new Error('row not found')

    fireEvent.click(row)
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('keeps plain row semantics (no role/tabindex) when onRowClick is present', () => {
    render(
      <Table<Row> columns={columns} data={[{ id: 1, name: 'Alpha' }]} emptyMessage={empty} onRowClick={() => {}} />,
    )
    const row = screen.getByText('Alpha').closest('tr')
    if (!row) throw new Error('row not found')
    expect(row).not.toHaveAttribute('role')
    expect(row).not.toHaveAttribute('tabindex')
  })
})
