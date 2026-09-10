import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pager } from './Pager'

const href = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href')

describe('Pager', () => {
  /*
   * A pager that is always present but always disabled is a permanent
   * invitation to look for rows that are not there.
   */
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pager total={12} limit={50} offset={0} basePath="/orders" lang="en" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says where you are and how much there is', () => {
    render(<Pager total={120} limit={50} offset={50} basePath="/orders" lang="en" />)
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument()
    expect(screen.getByText(/120/)).toBeInTheDocument()
  })

  /*
   * Absent, not disabled: a disabled `<a>` is not a thing the platform has —
   * `aria-disabled` still leaves it focusable and followable — and the count
   * beside it already says which end you are at.
   */
  it('offers no previous on the first page and no next on the last', () => {
    const { unmount } = render(<Pager total={120} limit={50} offset={0} basePath="/orders" lang="en" />)
    expect(screen.queryByRole('link', { name: /previous/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /next/i })).toBeInTheDocument()
    unmount()

    render(<Pager total={120} limit={50} offset={100} basePath="/orders" lang="en" />)
    expect(screen.getByRole('link', { name: /previous/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /next/i })).not.toBeInTheDocument()
  })

  it('steps by exactly one window in each direction', () => {
    render(<Pager total={300} limit={50} offset={100} basePath="/orders" lang="en" />)
    expect(href(/next/i)).toBe('/orders?offset=150')
    expect(href(/previous/i)).toBe('/orders?offset=50')
  })

  /*
   * Page one is the bare URL. It is the one people copy and paste, and
   * `?offset=0` on it would make two spellings of the same page.
   */
  it('links back to page one without an offset', () => {
    render(<Pager total={120} limit={50} offset={50} basePath="/orders" lang="en" />)
    expect(href(/previous/i)).toBe('/orders')
  })

  /*
   * The whole reason the component takes the current query: paging out of a
   * filtered list and back into an unfiltered one is how a person loses the
   * search they typed.
   */
  it('carries the filters the page was rendered with', () => {
    render(
      <Pager
        total={300}
        limit={50}
        offset={0}
        basePath="/infrastructure"
        params={{ status: 'active', search: 'web', lang: 'de' }}
        lang="de"
      />,
    )
    const next = href(/weiter|next/i) ?? ''
    expect(next).toContain('status=active')
    expect(next).toContain('search=web')
    expect(next).toContain('offset=50')
  })

  it('does not carry a stale offset forward from the query', () => {
    render(
      <Pager
        total={300}
        limit={50}
        offset={50}
        basePath="/infrastructure"
        params={{ offset: '50', status: 'active' }}
        lang="en"
      />,
    )
    // One offset in the URL, and it is the one the pager computed.
    expect((href(/next/i)?.match(/offset=/g) ?? []).length).toBe(1)
    expect(href(/next/i)).toContain('offset=100')
  })

  /*
   * A partial last page still counts as a page: 101 rows at 50 is three, not
   * two, and truncating there hides the last row of the list entirely.
   */
  it('counts a partial last page', () => {
    render(<Pager total={101} limit={50} offset={0} basePath="/orders" lang="en" />)
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
  })
})
