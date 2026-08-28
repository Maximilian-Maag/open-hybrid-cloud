import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SkeletonCard, SkeletonRow, SkeletonListItem, LoadingRegion } from './Skeleton'
import * as Skeletons from './Skeleton'

/**
 * Loading placeholders. The one with real behaviour is SkeletonRow: it is
 * rendered inside a <tbody> while a table loads, and a row whose cell count
 * disagrees with the header collapses the column widths — the table visibly
 * jumps when the data arrives.
 */

const inTable = (row: React.ReactNode) => render(<table><tbody>{row}</tbody></table>)

/*
 * Counted in the DOM, not by role. The row is `aria-hidden` — four identical
 * placeholder rows announcing empty cells is noise, and the one announcement
 * belongs to `LoadingRegion` (#155) — so its cells have no role to query. What
 * these assert is a LAYOUT property: a row whose cell count disagrees with the
 * header collapses the column widths.
 */
const cellsIn = (container: HTMLElement) => container.querySelectorAll('td')

describe('SkeletonRow', () => {
  it('draws one cell per column it is told about', () => {
    const { container } = inTable(<SkeletonRow cols={7} />)
    expect(cellsIn(container)).toHaveLength(7)
  })

  it('defaults to four columns', () => {
    const { container } = inTable(<SkeletonRow />)
    expect(cellsIn(container)).toHaveLength(4)
  })

  it('renders nothing at all for a zero-column table', () => {
    const { container } = inTable(<SkeletonRow cols={0} />)
    expect(cellsIn(container)).toHaveLength(0)
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

/**
 * Two things #155 needs from these, and they pull in opposite directions.
 *
 * The gate needs a DOM hook it can wait on, because `goto` resolves before
 * hydration has fired the fetch and the scan was landing on placeholders. A
 * screen reader needs them to be quiet, because a page renders four to eight of
 * them and each one speaking would be four to eight announcements of nothing.
 */
describe('what a placeholder tells the outside world', () => {
  it('marks itself for the accessibility gate to wait on', () => {
    const { container } = render(<><SkeletonCard /><SkeletonListItem /></>)
    expect(container.querySelectorAll('[data-loading]')).toHaveLength(2)
  })

  it('marks the table row too, which sits in a different tree', () => {
    const { container } = inTable(<SkeletonRow cols={2} />)
    expect(container.querySelector('tr')).toHaveAttribute('data-loading')
  })

  // Hidden from assistive technology, not from the gate: `aria-hidden` does not
  // remove the node, so the locator still finds it.
  it('says nothing to a screen reader', () => {
    const { container } = render(<><SkeletonCard /><SkeletonListItem /></>)
    for (const el of container.querySelectorAll('[data-loading]')) {
      expect(el).toHaveAttribute('aria-hidden', 'true')
    }
  })
})

describe('LoadingRegion', () => {
  // WCAG 4.1.3. Before this a client-rendered page was silent while it loaded:
  // the pulse animation is the only thing that ever said "loading", and it says
  // it exclusively to people who can see it.
  it('announces the wait once, politely', () => {
    render(<LoadingRegion label="Loading"><SkeletonCard /></LoadingRegion>)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-busy', 'true')
    // Its CONTENT, not its name: a live region is announced by what is inside
    // it. `toHaveAccessibleName` looks for aria-label/labelledby and finds
    // nothing here, which is correct — a status region does not need a name,
    // it needs something to say.
    expect(status).toHaveTextContent(/loading/i)
  })

  // One region, however many placeholders are inside it.
  it('speaks once for eight placeholders', () => {
    render(
      <LoadingRegion label="Loading">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </LoadingRegion>,
    )
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  // The placeholders already carry the visual message; a second one in text
  // would be duplication for everyone who can see them.
  it('does not show the label to people who can see the placeholders', () => {
    render(<LoadingRegion label="Loading"><SkeletonCard /></LoadingRegion>)
    expect(screen.getByText('Loading')).toHaveClass('sr-only')
  })
})

/**
 * Every placeholder, including ones added later.
 *
 * The gate waits on `[data-loading]`. A new `Skeleton*` export that forgot the
 * attribute would put the gate quietly back to scanning placeholders — the exact
 * failure #155 is about, and one nothing else would notice, because a skeleton
 * has no violations to report.
 */
describe('every Skeleton export', () => {
  // `Skeleton*` only: LoadingRegion is the thing AROUND them and takes props.
  const shapes = Object.entries(Skeletons).filter(([name]) => name.startsWith('Skeleton')) as [
    string,
    () => React.ReactElement,
  ][]

  it('there is at least one, so this loop cannot pass by being empty', () => {
    expect(shapes.length).toBeGreaterThan(0)
  })

  it.each(shapes)('%s carries the attribute the gate waits on', (name, Component) => {
    const element = <Component />
    // A <tr> needs a table around it or React drops it.
    const { container } = name === 'SkeletonRow' ? inTable(element) : render(element)
    expect(
      container.querySelector('[data-loading]'),
      `${name} renders no [data-loading], so e2e/a11y.spec.ts will scan it as if it were the page`,
    ).not.toBeNull()
  })
})
