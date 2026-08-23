import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category } from '@open-hybrid-cloud/types'

// jsdom does not implement the native <dialog> methods; stub them so Modal's
// open/close effects don't throw (same stub as ProductEditForm.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

const toast = vi.fn()
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

vi.mock('@/lib/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

import { CategoriesManager } from './CategoriesManager'
import { get, post, put } from '@/lib/api'

const mockedGet = vi.mocked(get)
const mockedPost = vi.mocked(post)
const mockedPut = vi.mocked(put)

const categories: Category[] = [
  { id: 1, name: 'Databases', displayOrder: 40 },
  { id: 2, name: 'Networking', displayOrder: 0 },
]

beforeEach(() => {
  toast.mockReset()
  mockedGet.mockReset().mockResolvedValue(categories as never)
  mockedPost.mockReset().mockResolvedValue(undefined as never)
  mockedPut.mockReset().mockResolvedValue(undefined as never)
})

describe('CategoriesManager display order', () => {
  it('keeps the category\'s own order when Display Order is cleared on edit (#146)', async () => {
    // `Number('')` is `0`, not `NaN` — clearing the field on a category
    // ordered 40 must not silently save it as 0 and jump it to the top of
    // every catalogue sidebar.
    const user = userEvent.setup()
    render(<CategoriesManager token="tok" />)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])
    const dialog = screen.getByRole('dialog', { name: 'Edit Category' })
    const orderInput = within(dialog).getByLabelText(/display order/i)
    expect(orderInput).toHaveValue(40)

    await user.clear(orderInput)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/categories/1', { name: 'Databases', displayOrder: 40 }, 'tok')
  })

  it('still saves a genuine 0 typed for a new category', async () => {
    // The fallback must trigger only on an empty field, not treat every 0 as
    // "unset" — Networking's own order really is 0.
    const user = userEvent.setup()
    render(<CategoriesManager token="tok" />)

    await user.click(await screen.findByRole('button', { name: 'Add Category' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Category' })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Storage')
    // Display Order already defaults to '0' in the Add form.
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    expect(mockedPost).toHaveBeenCalledWith('/api/admin/categories', { name: 'Storage', displayOrder: 0 }, 'tok')
  })

  it('saves a newly typed order normally', async () => {
    const user = userEvent.setup()
    render(<CategoriesManager token="tok" />)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])
    const dialog = screen.getByRole('dialog', { name: 'Edit Category' })
    const orderInput = within(dialog).getByLabelText(/display order/i)
    await user.clear(orderInput)
    await user.type(orderInput, '5')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/categories/1', { name: 'Databases', displayOrder: 5 }, 'tok')
  })
})
