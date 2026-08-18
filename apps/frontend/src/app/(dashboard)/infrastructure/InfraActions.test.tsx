import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InfrastructureElement } from '@open-hybrid-cloud/types'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))

vi.mock('@/lib/api', () => ({ post: vi.fn() }))

import { InfraActions } from './InfraActions'
import { post } from '@/lib/api'

const mockedPost = vi.mocked(post)

const element = (over?: Partial<InfrastructureElement>) => ({
  id: 42,
  orderId: 7,
  projectId: 1,
  environmentId: 2,
  productId: 3,
  status: 'active',
  parameters: {},
  pipelineId: [],
  outputs: {},
  deployedAt: null,
  productName: 'Nginx Gateway',
  ...over,
} as unknown as InfrastructureElement)

const renderActions = (over?: Partial<InfrastructureElement>, canRetry = true) =>
  render(<InfraActions item={element(over)} token="test-token" lang="en" canRetry={canRetry} />)

beforeEach(() => {
  refresh.mockReset()
  mockedPost.mockReset().mockResolvedValue(undefined as never)
})

describe('InfraActions retry', () => {
  it('offers Retry only when the deployment failed', () => {
    // The element is 'active' either way — it is created when provisioning
    // starts — so the failure is only visible on the order.
    const { unmount } = renderActions({ orderStatus: 'completed' })
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
    unmount()

    renderActions({ orderStatus: 'failed' })
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
  })

  it('hides Retry from a user who may not trigger pipelines', () => {
    renderActions({ orderStatus: 'failed' }, false)
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
  })

  it('replaces Decommission with Retry for a failed deployment', () => {
    // Tearing down something that was never provisioned is not the action the
    // operator wants, and would fire a destroy against nothing.
    renderActions({ orderStatus: 'failed' })
    expect(screen.queryByRole('button', { name: /decommission/i })).not.toBeInTheDocument()

    const { unmount } = renderActions({ orderStatus: 'completed' })
    expect(screen.getAllByRole('button', { name: /decommission/i }).length).toBeGreaterThan(0)
    unmount()
  })

  it('posts the retry once confirmed and refreshes', async () => {
    const user = userEvent.setup()
    renderActions({ orderStatus: 'failed' })

    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    expect(mockedPost).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: /retry deployment/i })
    await user.click(within(dialog).getByRole('button', { name: /^retry$/i }))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/api/infrastructure/42/retry', {}, 'test-token'),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderActions({ orderStatus: 'failed' })

    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    const dialog = await screen.findByRole('dialog', { name: /retry deployment/i })
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(mockedPost).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows which triggers still need attention', async () => {
    // A partial retry comes back 502 listing them — that list is the message.
    const user = userEvent.setup()
    mockedPost.mockRejectedValue(
      new Error('Retry started 1 pipeline(s), but 1 could not be started: pipeline stack "b" (#2): boom'),
    )
    renderActions({ orderStatus: 'failed' })

    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    const dialog = await screen.findByRole('dialog', { name: /retry deployment/i })
    await user.click(within(dialog).getByRole('button', { name: /^retry$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be started/i)
    expect(screen.getByRole('dialog', { name: /retry deployment/i })).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('explains that the original parameters are reused', async () => {
    const user = userEvent.setup()
    renderActions({ orderStatus: 'failed' })

    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    const dialog = await screen.findByRole('dialog', { name: /retry deployment/i })
    expect(within(dialog).getByText(/same parameters/i)).toBeInTheDocument()
  })
})

describe('InfraActions reorder', () => {
  it('always offers Reorder, whatever the status', () => {
    for (const status of ['active', 'decommissioning', 'decommissioned']) {
      const { unmount } = renderActions({ status } as Partial<InfrastructureElement>)
      expect(screen.getByRole('link', { name: /reorder/i })).toHaveAttribute(
        'href',
        '/catalog/3?fromInfra=42&projectId=1',
      )
      unmount()
    }
  })
})
