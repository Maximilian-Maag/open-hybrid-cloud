import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

const classesOf = (name: RegExp) => screen.getByRole('button', { name }).className

describe('Button', () => {
  it('calls onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not call onClick while disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Save</Button>)

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('gives the primary variant a border, so a near-white brand colour is still a control', () => {
    // The fill is the branding secondary colour, which an operator may set to
    // something indistinguishable from the page (#f5f5f4 is a real value here).
    render(<Button>Add to cart</Button>)
    expect(classesOf(/add to cart/i)).toContain('border')
  })

  it.each([
    ['danger', /delete/i, <Button variant="danger" key="d">Delete</Button>],
    ['secondary', /cancel/i, <Button variant="secondary" key="s">Cancel</Button>],
  ])('gives the %s variant a visible boundary', (_variant, name, element) => {
    render(element)
    expect(classesOf(name)).toMatch(/\bborder\b/)
  })

  it('marks the ghost variant as interactive without a border', () => {
    // A border would make it identical to `secondary`; an underline is the other
    // affordance a sighted user reads as "this does something".
    render(<Button variant="ghost">Edit</Button>)
    const classes = classesOf(/edit/i)
    expect(classes).toContain('underline')
    expect(classes).not.toMatch(/\bborder\b/)
  })

  it('keeps a focus ring with an explicit colour', () => {
    // Tailwind emits the ring custom properties either way, so an unset colour
    // renders a fully transparent ring — no visible focus indicator at all.
    render(<Button>Save</Button>)
    expect(classesOf(/save/i)).toContain('focus-visible:ring-blue-500')
  })
})
