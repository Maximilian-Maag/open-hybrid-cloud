import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Modal } from './Modal'

// jsdom does not implement the native <dialog> methods; stub them so the
// open/close effects don't throw.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

describe('Modal', () => {
  it('gives the dialog an accessible name via aria-labelledby', () => {
    render(
      <Modal open onClose={() => {}} title="Confirm delete">
        <p>Body</p>
      </Modal>,
    )
    const heading = screen.getByRole('heading', { name: 'Confirm delete' })
    const dialog = heading.closest('dialog')
    if (!dialog) throw new Error('dialog not found')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(heading.id).toBe(labelledBy)
  })

  it('renders a labeled close button', () => {
    render(
      <Modal open onClose={() => {}} title="X">
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })
})
