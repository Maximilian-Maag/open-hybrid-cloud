import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { DeploymentEnvironment } from '@open-hybrid-cloud/types'

// jsdom does not implement the native <dialog> methods; stub them so Modal's
// open/close effects don't throw (same stub as CategoriesManager.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

vi.mock('@/lib/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

import { EnvironmentsManager } from './EnvironmentsManager'
import { get } from '@/lib/api'

const mockedGet = vi.mocked(get)

const envs: DeploymentEnvironment[] = [
  { id: 1, name: 'Production', description: 'Live', ciSourceId: 1, webhookUrl: 'https://gitlab/api/v4/projects/8/trigger/pipeline' },
] as unknown as DeploymentEnvironment[]

beforeEach(() => {
  mockedGet.mockReset()
})

describe('EnvironmentsManager load failure', () => {
  // The list had a `try`/`finally` with no `catch`: a failed load left `envs`
  // empty and rendered the empty-state copy, which tells an administrator their
  // environments do not exist at the moment they are least able to check.
  it('reports a failed load instead of claiming there are no environments', async () => {
    mockedGet.mockRejectedValue(new Error('502 Bad Gateway'))

    render(<EnvironmentsManager ciSources={[]} />)

    expect(await screen.findByText('502 Bad Gateway')).toBeInTheDocument()
    expect(screen.queryByText(/no environments yet/i)).not.toBeInTheDocument()
  })

  it('clears the error once a later load succeeds', async () => {
    mockedGet.mockRejectedValueOnce(new Error('502 Bad Gateway'))
    render(<EnvironmentsManager ciSources={[]} />)
    expect(await screen.findByText('502 Bad Gateway')).toBeInTheDocument()

    mockedGet.mockResolvedValue(envs as never)
    // A second mount stands in for the retry path — the point is that the
    // error is cleared by a successful load rather than latched forever.
    render(<EnvironmentsManager ciSources={[]} />)

    await waitFor(() => expect(screen.getByText('Production')).toBeInTheDocument())
  })

  it('still shows the empty state when the load succeeds with nothing in it', async () => {
    mockedGet.mockResolvedValue([] as never)

    render(<EnvironmentsManager ciSources={[]} />)

    expect(await screen.findByText(/no environments yet/i)).toBeInTheDocument()
  })
})
