import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { get } from '@/lib/api'
import { SettingsForms } from './SettingsForms'

vi.mock('@/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('@/lib/useLang', () => ({ useLang: () => 'en' }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: {}, update: vi.fn() }),
  getSession: vi.fn(),
}))

const mockedGet = vi.mocked(get)

const props = { token: 'tok', initialName: 'Root', email: 'root@test.dev' }

beforeEach(() => {
  mockedGet.mockReset()
  mockedGet.mockResolvedValue({
    enabled: false,
    confirmedAt: null,
    pending: false,
    recoveryCodesRemaining: 0,
    lockedUntil: null,
  })
})

describe('SettingsForms — the two-factor card', () => {
  // Both administrative roles since #197: `admin` must hold a factor too, so a
  // card that stayed root-only would leave them required to enroll with nowhere
  // to do it.
  it.each(['root', 'admin'] as const)('shows it to %s', async (role) => {
    render(<SettingsForms {...props} role={role} />)
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument()
  })

  it('hides it from project_manager, and never asks the backend for their status', async () => {
    render(<SettingsForms {...props} role="project_manager" />)

    // The profile form is there, so the page rendered — the card is simply absent.
    expect(await screen.findByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.queryByText('Two-factor authentication')).toBeNull()
    await waitFor(() => expect(mockedGet).not.toHaveBeenCalled())
  })
})
