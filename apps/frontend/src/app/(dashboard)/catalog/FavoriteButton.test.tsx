import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavoriteButton } from './FavoriteButton'

describe('FavoriteButton', () => {
  it('exposes its state via aria-pressed, not only via colour', async () => {
    // The two states differ visually only by fill, which is invisible to a screen
    // reader and to anyone who cannot tell the shades apart.
    const { unmount } = render(<FavoriteButton favorited={false} onToggle={() => {}} lang="en" />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
    unmount()

    render(<FavoriteButton favorited onToggle={() => {}} lang="en" />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('names the action it will perform', () => {
    const { unmount } = render(<FavoriteButton favorited={false} onToggle={() => {}} lang="en" />)
    expect(screen.getByRole('button', { name: /add to favorites/i })).toBeInTheDocument()
    unmount()

    render(<FavoriteButton favorited onToggle={() => {}} lang="en" />)
    expect(screen.getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument()
  })

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(<FavoriteButton favorited={false} onToggle={onToggle} lang="en" />)

    await user.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('is disabled while a toggle is in flight', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(<FavoriteButton favorited={false} busy onToggle={onToggle} lang="en" />)

    expect(screen.getByRole('button')).toBeDisabled()
    await user.click(screen.getByRole('button'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('translates its label', () => {
    render(<FavoriteButton favorited={false} onToggle={() => {}} lang="de" />)
    expect(screen.getByRole('button', { name: /zu favoriten hinzufügen/i })).toBeInTheDocument()
  })
})
