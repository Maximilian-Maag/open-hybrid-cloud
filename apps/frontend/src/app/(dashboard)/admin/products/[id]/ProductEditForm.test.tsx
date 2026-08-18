import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProductDetail, Category, DeploymentEnvironment } from '@open-hybrid-cloud/types'

// jsdom does not implement the native <dialog> methods; stub them so Modal's
// open/close effects don't throw (same stub as Modal.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))

vi.mock('@/lib/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

import { ProductEditForm } from './ProductEditForm'
import { get, del } from '@/lib/api'

const mockedGet = vi.mocked(get)
const mockedDel = vi.mocked(del)

const LINKED_ENV = 1
const UNLINKED_ENV = 2

const environments = [
  { id: LINKED_ENV, name: 'AWS Frankfurt' },
  { id: UNLINKED_ENV, name: 'On-Premise Vienna' },
] as unknown as DeploymentEnvironment[]

const product = {
  id: 7,
  categoryId: 1,
  baseLanguage: 'en',
  createdAt: new Date().toISOString(),
  name: 'Managed Postgres',
  description: '',
  // Only AWS Frankfurt is offered — On-Premise Vienna is listed but unlinked.
  environments: [
    { productId: 7, environmentId: LINKED_ENV, price: '12.00', currency: 'EUR', costCenterMode: 'project', forcedCostCenter: false },
  ],
  parameters: [],
} as unknown as ProductDetail

const renderForm = () =>
  render(
    <ProductEditForm
      product={product}
      categories={[{ id: 1, name: 'Databases', displayOrder: 0 }] as Category[]}
      environments={environments}
      translations={[]}
      token="test-token"
    />,
  )

beforeEach(() => {
  refresh.mockReset()
  mockedDel.mockReset().mockResolvedValue(undefined as never)
  // Pipeline stacks are fetched on mount — not exercised here.
  mockedGet.mockReset().mockResolvedValue([] as never)
})

describe('ProductEditForm environment removal', () => {
  it('offers Remove only for environments the product is actually linked to', () => {
    renderForm()

    // One Remove button, and it belongs to the linked environment's row. The
    // row is identified by its own heading — the environment names also appear
    // in the webhook/stack modals' environment <select>s.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    expect(removeButtons).toHaveLength(1)
    const row = removeButtons[0].closest('form')
    if (!row) throw new Error('environment row not found')
    expect(within(row).getByRole('heading', { name: 'AWS Frankfurt' })).toBeInTheDocument()
  })

  it('deletes the offering and refreshes once confirmed', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    // Nothing is sent from opening the dialog alone.
    expect(mockedDel).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: /Remove AWS Frankfurt\?/ })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(mockedDel).toHaveBeenCalledWith(
        `/api/admin/products/7/environments/${LINKED_ENV}`,
        'test-token',
      )
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog', { name: /Remove AWS Frankfurt\?/ })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(mockedDel).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('surfaces the backend refusal and keeps the dialog open', async () => {
    const user = userEvent.setup()
    mockedDel.mockRejectedValue(
      new Error('Infrastructure is still deployed in this environment — decommission it first'),
    )
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog', { name: /Remove AWS Frankfurt\?/ })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/decommission it first/)
    // Still open, so the operator sees the reason next to the action that failed.
    expect(screen.getByRole('dialog', { name: /Remove AWS Frankfurt\?/ })).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})
