import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { get } from '@/lib/api'
import { SettingsForms } from './SettingsForms'

vi.mock('@/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('@/lib/useLang', () => ({ useLang: () => 'en' }))

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
  it('shows it to root', async () => {
    render(<SettingsForms {...props} role="root" />)
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument()
  })

  it.each(['admin', 'project_manager'] as const)(
    'hides it from %s, and never asks the backend for their status',
    async (role) => {
      render(<SettingsForms {...props} role={role} />)

      // The profile form is there, so the page rendered — the card is simply absent.
      expect(await screen.findByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.queryByText('Two-factor authentication')).toBeNull()
      await waitFor(() => expect(mockedGet).not.toHaveBeenCalled())
    },
  )
})
