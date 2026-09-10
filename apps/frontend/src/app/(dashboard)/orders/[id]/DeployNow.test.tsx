import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/api', () => ({ post: vi.fn() }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { DeployNow } from './DeployNow'
import { post } from '@/lib/api'

const mockedPost = vi.mocked(post)

/**
 * Root releasing a scheduled order early (#330).
 *
 * Two things worth asserting: it refreshes rather than guessing the new status
 * locally — provisioning may have failed — and a refusal is shown in the
 * server's words, because only the server knows the sweep got there first.
 */
beforeEach(() => {
  vi.resetAllMocks()
  mockedPost.mockResolvedValue(undefined)
})

describe('DeployNow', () => {
  it('posts to the order and refreshes from the server', async () => {
    const user = userEvent.setup()
    render(<DeployNow orderId={412} />)

    await user.click(screen.getByRole('button', { name: /deploy now/i }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/orders/412/deploy-now', {}))
    // Not an optimistic local status: the provisioning it just started can fail.
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the server’s refusal and does not refresh', async () => {
    const user = userEvent.setup()
    mockedPost.mockRejectedValue(new Error('Only a scheduled order can be deployed early; this one is provisioning'))
    render(<DeployNow orderId={412} />)

    await user.click(screen.getByRole('button', { name: /deploy now/i }))

    expect(await screen.findByText(/this one is provisioning/i)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  // Two clicks must not be two deployments; the claim would refuse the second,
  // but the button should not invite it.
  it('disables itself while the request is in flight', async () => {
    const user = userEvent.setup()
    let release: (() => void) | undefined
    mockedPost.mockImplementation(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined) }))
    render(<DeployNow orderId={412} />)

    await user.click(screen.getByRole('button', { name: /deploy now/i }))

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled())
    release?.()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
