import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrialBadge } from './TrialBadge'
import { t } from '@/lib/i18n'

/**
 * What the approver is agreeing to when they approve a trial: a deployment that
 * is torn down again shortly after it comes up, with elevated rights inside it.
 * The duration is the part that changes the decision, so it must survive every
 * value it can take — including zero.
 */

describe('TrialBadge', () => {
  it('says "Trial" in English by default', () => {
    render(<TrialBadge />)
    expect(screen.getByText(/Trial/)).toBeInTheDocument()
  })

  it('translates the label', () => {
    render(<TrialBadge lang="de" />)
    expect(screen.getByText(new RegExp(t('trial', 'de')))).toBeInTheDocument()
  })

  it('appends the duration when one is given', () => {
    render(<TrialBadge minutes={30} />)
    expect(screen.getByText(/30 min trial/)).toBeInTheDocument()
  })

  it('shows a zero-minute trial rather than hiding the duration', () => {
    // `minutes && ...` would drop the duration for 0, and an approver would see
    // a plain "Trial" for the one case that is most surprising.
    render(<TrialBadge minutes={0} />)
    expect(screen.getByText(/0 min trial/)).toBeInTheDocument()
  })

  it('shows no duration at all when none is known', () => {
    const { container } = render(<TrialBadge />)
    expect(container.textContent).not.toContain('·')
  })

  it('translates the duration suffix too', () => {
    render(<TrialBadge lang="de" minutes={15} />)
    expect(screen.getByText(new RegExp(`15 ${t('trialMinutes', 'de')}`))).toBeInTheDocument()
  })

  it('hides its icon from assistive tech', () => {
    // The text already says "Trial"; the clock would otherwise be announced.
    const { container } = render(<TrialBadge />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
