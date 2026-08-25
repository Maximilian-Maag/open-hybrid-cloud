import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SkeletonCard, SkeletonRow, SkeletonListItem } from './Skeleton'

/**
 * Loading placeholders. The one with real behaviour is SkeletonRow: it is
 * rendered inside a <tbody> while a table loads, and a row whose cell count
 * disagrees with the header collapses the column widths — the table visibly
 * jumps when the data arrives.
 */

const inTable = (row: React.ReactNode) => render(<table><tbody>{row}</tbody></table>)

describe('SkeletonRow', () => {
  it('draws one cell per column it is told about', () => {
    inTable(<SkeletonRow cols={7} />)
    expect(screen.getAllByRole('cell')).toHaveLength(7)
  })

  it('defaults to four columns', () => {
    inTable(<SkeletonRow />)
    expect(screen.getAllByRole('cell')).toHaveLength(4)
  })

  it('renders nothing at all for a zero-column table', () => {
    inTable(<SkeletonRow cols={0} />)
    expect(screen.queryAllByRole('cell')).toHaveLength(0)
  })

  it('is a table row, so it can sit in a tbody', () => {
    const { container } = inTable(<SkeletonRow cols={2} />)
    expect(container.querySelector('tbody > tr')).toBeInTheDocument()
  })

  it('animates, so it reads as loading rather than as empty data', () => {
    const { container } = inTable(<SkeletonRow cols={2} />)
    expect(container.querySelector('tr')).toHaveClass('animate-pulse')
  })
})

describe('SkeletonCard and SkeletonListItem', () => {
  it('render an animated placeholder', () => {
    const { container } = render(<SkeletonCard />)
    expect(container.firstElementChild).toHaveClass('animate-pulse')
  })

  it('render no text for a screen reader to announce', () => {
    // A placeholder that announced its filler text would read as content.
    const { container } = render(<><SkeletonCard /><SkeletonListItem /></>)
    expect(container.textContent).toBe('')
  })

  it('gives the list item an animated placeholder too', () => {
    const { container } = render(<SkeletonListItem />)
    expect(container.firstElementChild).toHaveClass('animate-pulse')
  })
})
