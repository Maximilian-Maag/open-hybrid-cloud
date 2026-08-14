import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Table } from './Table'

interface Row { id: number; name: string }
const columns = [{ header: 'Name', accessor: 'name' as const }]

describe('Table', () => {
  it('renders column headers with scope="col"', () => {
    render(<Table<Row> columns={columns} data={[{ id: 1, name: 'Alpha' }]} />)
    const th = screen.getByText('Name')
    expect(th.tagName).toBe('TH')
    expect(th).toHaveAttribute('scope', 'col')
  })

  it('renders the empty message when there is no data', () => {
    render(<Table<Row> columns={columns} data={[]} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('fires onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn()
    render(
      <Table<Row>
        columns={columns}
        data={[{ id: 1, name: 'Alpha' }]}
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
      <Table<Row> columns={columns} data={[{ id: 1, name: 'Alpha' }]} onRowClick={() => {}} />,
    )
    const row = screen.getByText('Alpha').closest('tr')
    if (!row) throw new Error('row not found')
    expect(row).not.toHaveAttribute('role')
    expect(row).not.toHaveAttribute('tabindex')
  })
})
