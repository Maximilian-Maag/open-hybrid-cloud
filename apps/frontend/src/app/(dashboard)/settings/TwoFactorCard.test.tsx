import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TwoFactorStatusResponse } from '@open-hybrid-cloud/types'
import { get, post } from '@/lib/api'
import { TwoFactorCard } from './TwoFactorCard'

vi.mock('@/lib/api', () => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/useLang', () => ({ useLang: () => 'en' }))

const mockedGet = vi.mocked(get)
const mockedPost = vi.mocked(post)

const status = (overrides: Partial<TwoFactorStatusResponse> = {}): TwoFactorStatusResponse => ({
  enabled: false,
  confirmedAt: null,
  pending: false,
  recoveryCodesRemaining: 0,
  lockedUntil: null,
  ...overrides,
})

const OFFER = {
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  secretFormatted: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
  otpauthUrl: 'otpauth://totp/OHC:root@test.dev?secret=GEZDGNBVGY3TQOJQ',
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
})

describe('TwoFactorCard — not yet set up', () => {
  it('offers to set it up, asking only for the password', async () => {
    mockedGet.mockResolvedValue(status())
    render(<TwoFactorCard token="tok" />)

    expect(await screen.findByText('Not set up')).toBeInTheDocument()
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
    // No current code is asked for: there is no factor to prove yet.
    expect(screen.queryByLabelText(/authentication code/i)).toBeNull()
  })

  it('shows the QR code and the setup key after the password is accepted', async () => {
    mockedGet.mockResolvedValue(status())
    mockedPost.mockResolvedValue(OFFER)
    render(<TwoFactorCard token="tok" />)

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/current password/i), 'pw')
    await user.click(screen.getByRole('button', { name: /set up/i }))

    expect(await screen.findByText(OFFER.secretFormatted)).toBeInTheDocument()
    expect(mockedPost.mock.calls[0][0]).toBe('/api/users/me/2fa/enroll')
    expect(mockedPost.mock.calls[0][1]).toEqual({ password: 'pw' })
    // The SVG is inlined, so there is no image request and no external service.
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('surfaces a rejected password without leaving the step', async () => {
    mockedGet.mockResolvedValue(status())
    mockedPost.mockRejectedValue(new Error('Current password is incorrect'))
    render(<TwoFactorCard token="tok" />)

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/current password/i), 'nope')
    await user.click(screen.getByRole('button', { name: /set up/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/password is incorrect/i)
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
  })

  it('shows the recovery codes once, and never asks for them again', async () => {
    mockedGet.mockResolvedValue(status())
    mockedPost.mockResolvedValueOnce(OFFER)
    mockedPost.mockResolvedValueOnce({ recoveryCodes: ['AAAAA-BBBBB-CCCCC-DDDDD', 'EEEEE-FFFFF-GGGGG-HHHHH'] })
    render(<TwoFactorCard token="tok" />)

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/current password/i), 'pw')
    await user.click(screen.getByRole('button', { name: /set up/i }))

    await user.type(await screen.findByLabelText(/authentication code/i), '123456')
    await user.click(screen.getByRole('button', { name: /activate/i }))

    expect(await screen.findByText('AAAAA-BBBBB-CCCCC-DDDDD')).toBeInTheDocument()
    expect(screen.getByText('EEEEE-FFFFF-GGGGG-HHHHH')).toBeInTheDocument()
    expect(mockedPost.mock.calls[1][0]).toBe('/api/users/me/2fa/confirm')

    // The secret is gone from the screen the moment it is no longer needed.
    expect(screen.queryByText(OFFER.secretFormatted)).toBeNull()
  })

  it('drops the pending secret when the enrollment is cancelled', async () => {
    mockedGet.mockResolvedValue(status())
    mockedPost.mockResolvedValue(OFFER)
    render(<TwoFactorCard token="tok" />)

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/current password/i), 'pw')
    await user.click(screen.getByRole('button', { name: /set up/i }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(screen.queryByText(OFFER.secretFormatted)).toBeNull()
    expect(await screen.findByLabelText(/current password/i)).toBeInTheDocument()
  })
})

describe('TwoFactorCard — already active', () => {
  it('reports the state and how many recovery codes are left', async () => {
    mockedGet.mockResolvedValue(
      status({ enabled: true, confirmedAt: new Date().toISOString(), recoveryCodesRemaining: 7 }),
    )
    render(<TwoFactorCard token="tok" />)

    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('offers only a replacement — never a way to switch it off', async () => {
    mockedGet.mockResolvedValue(status({ enabled: true, recoveryCodesRemaining: 7 }))
    render(<TwoFactorCard token="tok" />)

    expect(await screen.findByRole('button', { name: /replace authenticator/i })).toBeInTheDocument()
    for (const label of [/disable/i, /turn off/i, /remove/i, /delete/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
  })

  it('demands a current code as well as the password before replacing', async () => {
    mockedGet.mockResolvedValue(status({ enabled: true, recoveryCodesRemaining: 7 }))
    mockedPost.mockResolvedValue(OFFER)
    render(<TwoFactorCard token="tok" />)

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/current password/i), 'pw')
    await user.type(screen.getByLabelText(/authentication code/i), '123456')
    await user.click(screen.getByRole('button', { name: /replace authenticator/i }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    expect(mockedPost.mock.calls[0][1]).toEqual({ password: 'pw', code: '123456' })
  })

  it('warns when the recovery codes have run out', async () => {
    mockedGet.mockResolvedValue(status({ enabled: true, recoveryCodesRemaining: 0 }))
    render(<TwoFactorCard token="tok" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/only way in/i)
  })

  it('says nothing rather than erroring when the status cannot be read', async () => {
    mockedGet.mockRejectedValue(new Error('boom'))
    render(<TwoFactorCard token="tok" />)
    // The card still renders its intro and the set-up form; it does not take the
    // whole settings page down with it.
    expect(await screen.findByLabelText(/current password/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
