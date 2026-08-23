import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ApprovalDelegation, ApprovalDelegationsResponse } from '@open-hybrid-cloud/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ post: vi.fn(), del: vi.fn() }))

import { DelegationPanel } from './DelegationPanel'
import { post, del } from '@/lib/api'

const mockedPost = vi.mocked(post)
const mockedDel = vi.mocked(del)

/**
 * A calendar date offset from today, in the browser's local calendar — the same
 * one the panel's own `today()` uses.
 *
 * The panel hides a delegation whose `endsOn` is before today, so fixtures pinned
 * to fixed dates quietly stop testing what they claim to the day that period ends.
 */
const dayOffset = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** A period that is always still ahead, so the panel always lists it. */
const STARTS_ON = dayOffset(1)
const ENDS_ON = dayOffset(14)

const delegation = (over?: Partial<ApprovalDelegation>): ApprovalDelegation => ({
  id: 5,
  fromUserId: 1,
  fromUserName: 'Alice Admin',
  fromUserEmail: 'alice@test.dev',
  toUserId: 2,
  toUserName: 'Bob Admin',
  toUserEmail: 'bob@test.dev',
  startsOn: STARTS_ON,
  endsOn: ENDS_ON,
  createdAt: `${dayOffset(0)}T10:00:00.000Z`,
  revokedAt: null,
  active: true,
  ...over,
})

const view = (over?: Partial<ApprovalDelegationsResponse>): ApprovalDelegationsResponse => ({
  mine: [],
  grantedToMe: [],
  candidates: [{ id: 2, name: 'Bob Admin', email: 'bob@test.dev' }],
  ...over,
})

const renderPanel = (over?: Partial<ApprovalDelegationsResponse>) =>
  render(<DelegationPanel delegations={view(over)} token="test-token" />)

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue(undefined as never)
  mockedDel.mockReset().mockResolvedValue(undefined as never)
})

describe('DelegationPanel', () => {
  it('offers the form when the admin has delegated nothing', () => {
    renderPanel()
    expect(screen.getByLabelText(/substitute/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create delegation/i })).toBeInTheDocument()
  })

  it('says who the viewer is approving on behalf of', () => {
    renderPanel({ grantedToMe: [delegation()] })
    // The substitute has to know this before they start clearing a queue that is
    // not usually theirs — so it is a status message, not a footnote.
    const banner = screen.getByTestId('held-delegation-5')
    expect(banner).toHaveTextContent('Alice Admin')
    expect(screen.getByRole('status')).toContainElement(banner)
  })

  it('does not announce an authority the server says is not in force', () => {
    renderPanel({ grantedToMe: [delegation({ active: false })] })
    expect(screen.queryByTestId('held-delegation-5')).not.toBeInTheDocument()
  })

  it('lists the delegation the admin granted, with a revoke control', () => {
    renderPanel({ mine: [delegation()] })
    expect(screen.getByTestId('given-delegation-5')).toHaveTextContent('Bob Admin')
    // One live delegation per admin, so the create form is gone rather than
    // offering something the API would refuse.
    expect(screen.queryByRole('button', { name: /create delegation/i })).not.toBeInTheDocument()
  })

  it('hides a revoked delegation, which is kept only for the audit trail', () => {
    renderPanel({ mine: [delegation({ revokedAt: `${dayOffset(0)}T10:00:00.000Z`, active: false })] })
    expect(screen.queryByTestId('given-delegation-5')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create delegation/i })).toBeInTheDocument()
  })

  it('offers the form again once a delegation has run its course', () => {
    // `mine` carries every delegation the admin ever created, so filtering on
    // revokedAt alone kept a naturally expired one on screen forever — labelled
    // as if it were still scheduled, and, because the form is hidden whenever
    // anything is listed, locking the admin out of ever delegating again. The
    // API allows a second one; only the panel did not.
    // Deliberately a period that has already ENDED — that is the whole point of
    // this case, so both ends stay behind today however far today moves.
    renderPanel({
      mine: [delegation({ startsOn: dayOffset(-30), endsOn: dayOffset(-16), active: false })],
    })
    expect(screen.getByRole('button', { name: /create delegation/i })).toBeInTheDocument()
  })

  it('posts the substitute and the period', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.selectOptions(screen.getByLabelText(/substitute/i), '2')
    await user.clear(screen.getByLabelText(/^From/))
    await user.type(screen.getByLabelText(/^From/), STARTS_ON)
    await user.type(screen.getByLabelText(/^To/), ENDS_ON)
    await user.click(screen.getByRole('button', { name: /create delegation/i }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/approvals/delegations',
      { toUserId: 2, startsOn: STARTS_ON, endsOn: ENDS_ON },
      'test-token',
    )
  })

  it('shows the server’s refusal rather than a generic failure', async () => {
    const user = userEvent.setup()
    mockedPost.mockRejectedValue(new Error('You already have a delegation covering part of that period'))
    renderPanel()

    await user.selectOptions(screen.getByLabelText(/substitute/i), '2')
    await user.type(screen.getByLabelText(/^To/), ENDS_ON)
    await user.click(screen.getByRole('button', { name: /create delegation/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already have a delegation/i)
  })

  it('revokes through the delegations endpoint', async () => {
    const user = userEvent.setup()
    renderPanel({ mine: [delegation()] })

    await user.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(mockedDel).toHaveBeenCalledTimes(1))
    expect(mockedDel).toHaveBeenCalledWith('/api/approvals/delegations/5', 'test-token')
  })

  it('says so when there is nobody to nominate instead of an empty select', () => {
    renderPanel({ candidates: [] })
    expect(screen.getByText(/no other active admin/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/substitute/i)).not.toBeInTheDocument()
  })
})
