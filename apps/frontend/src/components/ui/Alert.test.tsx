import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Alert } from './Alert'

describe('Alert', () => {
  // The whole reason this component exists: these messages are inserted after a
  // submit, so without a live-region role a screen reader never announces them
  // (WCAG 4.1.3). 53 plain <div> banners were replaced by this.
  it('announces errors assertively via role="alert"', () => {
    render(<Alert>Wrong password</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password')
  })

  it('treats warnings as assertive too', () => {
    render(<Alert tone="warning">Pipeline partially failed</Alert>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('announces confirmations politely via role="status"', () => {
    render(<Alert tone="success">Profile updated</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('Profile updated')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses role="status" for info', () => {
    render(<Alert tone="info">Nothing to do</Alert>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('keeps positioning classes passed by the caller', () => {
    render(<Alert className="mb-4">Boom</Alert>)
    expect(screen.getByRole('alert')).toHaveClass('mb-4')
  })

  it('renders arbitrary children, not just a string', () => {
    render(
      <Alert>
        <p>Rejected</p>
        <p>Reason: budget</p>
      </Alert>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Rejected')
    expect(alert).toHaveTextContent('Reason: budget')
  })
})
