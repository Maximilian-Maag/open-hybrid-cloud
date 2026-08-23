import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OrderComment } from '@open-hybrid-cloud/types'

vi.mock('@/lib/api', () => ({ post: vi.fn(), put: vi.fn(), del: vi.fn() }))

import { OrderComments } from './OrderComments'
import { post, put, del } from '@/lib/api'

const mockedPost = vi.mocked(post)
const mockedPut = vi.mocked(put)
const mockedDel = vi.mocked(del)

const ME = 1
const THEM = 2

const comment = (over?: Partial<OrderComment>): OrderComment => ({
  id: 100,
  orderId: 7,
  userId: ME,
  body: 'Any update?',
  internal: false,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  userName: 'PM One',
  edited: false,
  ...over,
})

const renderThread = (
  initialComments: OrderComment[] = [],
  opts: { canWriteInternal?: boolean; currentUserId?: number } = {},
) =>
  render(
    <OrderComments
      orderId={7}
      initialComments={initialComments}
      currentUserId={opts.currentUserId ?? ME}
      canWriteInternal={opts.canWriteInternal ?? false}
      token="test-token"
      lang="en"
    />,
  )

beforeEach(() => {
  mockedPost.mockReset()
  mockedPut.mockReset()
  mockedDel.mockReset().mockResolvedValue(undefined as never)
})

describe('OrderComments', () => {
  it('shows an empty state rather than a bare form', () => {
    renderThread()
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument()
  })

  it('renders the thread with author and timestamp', () => {
    renderThread([comment()])
    const item = screen.getByTestId('comment-100')
    expect(within(item).getByText('PM One')).toBeInTheDocument()
    expect(within(item).getByText('Any update?')).toBeInTheDocument()
  })

  it('marks an edited comment as edited', () => {
    renderThread([comment({ edited: true })])
    expect(within(screen.getByTestId('comment-100')).getByText(/\(edited\)/i)).toBeInTheDocument()
  })

  it('labels an internal note so an admin cannot mistake it for a public one', () => {
    renderThread([comment({ internal: true })], { canWriteInternal: true })
    expect(within(screen.getByTestId('comment-100')).getByText(/internal note/i)).toBeInTheDocument()
  })

  it('posts a comment and appends it without a reload', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValue(comment({ id: 101, body: 'New one' }) as never)
    renderThread()

    await user.type(screen.getByLabelText(/add comment/i), 'New one')
    await user.click(screen.getByRole('button', { name: /add comment/i }))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/api/orders/7/comments', { body: 'New one' }, 'test-token'),
    )
    expect(await screen.findByTestId('comment-101')).toBeInTheDocument()
    // The box is cleared so the next comment starts empty.
    expect(screen.getByLabelText(/add comment/i)).toHaveValue('')
  })

  it('will not submit an empty or whitespace-only comment', async () => {
    const user = userEvent.setup()
    renderThread()

    expect(screen.getByRole('button', { name: /add comment/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/add comment/i), '   ')
    expect(screen.getByRole('button', { name: /add comment/i })).toBeDisabled()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('offers the internal toggle only to a user who may write one', () => {
    const { unmount } = renderThread([], { canWriteInternal: false })
    expect(screen.queryByLabelText(/internal note/i)).not.toBeInTheDocument()
    unmount()

    renderThread([], { canWriteInternal: true })
    expect(screen.getByLabelText(/internal note/i)).toBeInTheDocument()
    expect(screen.getByText(/orderer never sees it/i)).toBeInTheDocument()
  })

  it('sends internal: true only when the toggle is ticked', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValue(comment({ id: 102, internal: true }) as never)
    renderThread([], { canWriteInternal: true })

    await user.type(screen.getByLabelText(/add comment/i), 'note')
    await user.click(screen.getByLabelText(/internal note/i))
    await user.click(screen.getByRole('button', { name: /add comment/i }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    expect(mockedPost.mock.calls[0][1]).toEqual({ body: 'note', internal: true })
  })

  it('resets the internal toggle after posting', async () => {
    // Otherwise the next comment silently inherits it, and a reply meant for the
    // orderer would be invisible to them.
    const user = userEvent.setup()
    mockedPost.mockResolvedValue(comment({ id: 103, internal: true }) as never)
    renderThread([], { canWriteInternal: true })

    await user.type(screen.getByLabelText(/add comment/i), 'note')
    await user.click(screen.getByLabelText(/internal note/i))
    await user.click(screen.getByRole('button', { name: /add comment/i }))

    await waitFor(() => expect(screen.getByLabelText(/internal note/i)).not.toBeChecked())
  })

  it('offers Edit and Delete only on your own comment', () => {
    renderThread([comment({ id: 200, userId: ME }), comment({ id: 201, userId: THEM })])

    const mine = screen.getByTestId('comment-200')
    expect(within(mine).getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: /delete/i })).toBeInTheDocument()

    const theirs = screen.getByTestId('comment-201')
    expect(within(theirs).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(within(theirs).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('edits a comment in place', async () => {
    const user = userEvent.setup()
    mockedPut.mockResolvedValue(comment({ body: 'Revised', edited: true }) as never)
    renderThread([comment()])

    await user.click(within(screen.getByTestId('comment-100')).getByRole('button', { name: /edit/i }))
    const box = screen.getByLabelText(/^edit$/i)
    // The textarea starts from the existing text rather than blank.
    expect(box).toHaveValue('Any update?')

    await user.clear(box)
    await user.type(box, 'Revised')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/api/orders/7/comments/100', { body: 'Revised' }, 'test-token'),
    )
    expect(await screen.findByText('Revised')).toBeInTheDocument()
    expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument()
  })

  it('cancels an edit without sending anything', async () => {
    const user = userEvent.setup()
    renderThread([comment()])

    await user.click(within(screen.getByTestId('comment-100')).getByRole('button', { name: /edit/i }))
    await user.clear(screen.getByLabelText(/^edit$/i))
    await user.type(screen.getByLabelText(/^edit$/i), 'discarded')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockedPut).not.toHaveBeenCalled()
    expect(screen.getByText('Any update?')).toBeInTheDocument()
  })

  it('deletes a comment and drops it from the thread', async () => {
    const user = userEvent.setup()
    renderThread([comment()])

    await user.click(within(screen.getByTestId('comment-100')).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith('/api/orders/7/comments/100', 'test-token'))
    await waitFor(() => expect(screen.queryByTestId('comment-100')).not.toBeInTheDocument())
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument()
  })

  it('surfaces a failure and keeps the typed text', async () => {
    const user = userEvent.setup()
    mockedPost.mockRejectedValue(new Error('A comment cannot be empty'))
    renderThread()

    await user.type(screen.getByLabelText(/add comment/i), 'attempt')
    await user.click(screen.getByRole('button', { name: /add comment/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be empty/i)
    // Losing what the user typed on a failed post would be its own bug.
    expect(screen.getByLabelText(/add comment/i)).toHaveValue('attempt')
  })

  it('does not send a second DELETE for a double-click on the same comment (#146)', async () => {
    // Without a guard, `handlePost` was the only action that checked whether
    // a request was already in flight — a double-click here sent two DELETEs
    // and the second reported "Failed to delete the comment" for one that
    // had already been removed.
    let resolveDel: () => void = () => {}
    mockedDel.mockImplementation(() => new Promise((resolve) => { resolveDel = () => resolve(undefined as never) }))
    renderThread([comment()])

    const button = within(screen.getByTestId('comment-100')).getByRole('button', { name: /delete/i })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(mockedDel).toHaveBeenCalledTimes(1)
    resolveDel()
    await waitFor(() => expect(screen.queryByTestId('comment-100')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not send a second PUT for a double-click on Save Changes (#146)', async () => {
    let resolvePut: () => void = () => {}
    mockedPut.mockImplementation(
      () => new Promise((resolve) => { resolvePut = () => resolve(comment({ body: 'Revised', edited: true }) as never) }),
    )
    const user = userEvent.setup()
    renderThread([comment()])

    await user.click(within(screen.getByTestId('comment-100')).getByRole('button', { name: /edit/i }))
    const box = screen.getByLabelText(/^edit$/i)
    await user.clear(box)
    await user.type(box, 'Revised')

    const save = screen.getByRole('button', { name: /save changes/i })
    fireEvent.click(save)
    fireEvent.click(save)

    expect(mockedPut).toHaveBeenCalledTimes(1)
    resolvePut()
    await waitFor(() => expect(screen.getByText('Revised')).toBeInTheDocument())
  })

  it('leaves the comment in place when a delete fails', async () => {
    const user = userEvent.setup()
    mockedDel.mockRejectedValue(new Error('Only the author can change a comment'))
    renderThread([comment()])

    await user.click(within(screen.getByTestId('comment-100')).getByRole('button', { name: /delete/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/only the author/i)
    expect(screen.getByTestId('comment-100')).toBeInTheDocument()
  })
})
