import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CartItem, Project, CostCenter, Parameter, CheckoutResponse } from '@open-hybrid-cloud/types'

const push = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

vi.mock('@/lib/api', () => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))

import { CartView } from './CartView'
import { get, post, del } from '@/lib/api'

const mockedGet = vi.mocked(get)
const mockedPost = vi.mocked(post)
const mockedDel = vi.mocked(del)

const item = (over?: Partial<CartItem>): CartItem => ({
  id: 1,
  productId: 10,
  environmentId: 2,
  parameters: {},
  createdAt: '2026-06-01T10:00:00.000Z',
  productName: 'Nginx Gateway',
  environmentName: 'AWS Frankfurt',
  price: '10.00',
  currency: 'EUR',
  stillOffered: true,
  ...over,
})

const projects: Project[] = [
  { id: 5, name: 'Webshop', description: '', ownerId: 1, costCenterId: null, createdAt: '' },
  { id: 6, name: 'Billing', description: '', ownerId: 1, costCenterId: null, createdAt: '' },
]

const costCenters: CostCenter[] = [{ id: 20, code: 'CC-1', name: 'Platform', active: true }]

const param = (over?: Partial<Parameter>): Parameter => ({
  id: 1,
  scope: 'product',
  scopeId: 10,
  environmentId: null,
  name: 'HOST',
  label: 'Hostname',
  type: 'string',
  description: '',
  defaultValue: '',
  required: false,
  sensitive: false,
  ...over,
})

const renderCart = (items: CartItem[], p: Project[] = projects) =>
  render(<CartView initialItems={items} projects={p} costCenters={costCenters} token="t" lang="en" />)

beforeEach(() => {
  push.mockReset()
  refresh.mockReset()
  mockedGet.mockReset().mockResolvedValue({ parameters: [] } as never)
  mockedPost.mockReset().mockResolvedValue({ orderIds: [1], failed: [] } as never)
  mockedDel.mockReset().mockResolvedValue(undefined as never)
})

describe('CartView', () => {
  it('shows an empty state rather than a checkout form', () => {
    renderCart([])
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check out/i })).not.toBeInTheDocument()
  })

  it('renders one card per item with product, environment and price', () => {
    renderCart([item(), item({ id: 2, productName: 'Managed Postgres', price: '20.00' })])

    const first = screen.getByTestId('cart-item-1')
    expect(within(first).getByText('Nginx Gateway')).toBeInTheDocument()
    expect(within(first).getByText(/AWS Frankfurt · 10.00 EUR/)).toBeInTheDocument()
    expect(screen.getByTestId('cart-item-2')).toBeInTheDocument()
  })

  it('preselects the only project, and asks when there are several', () => {
    const { unmount } = renderCart([item()], [projects[0]])
    expect(screen.getByLabelText(/^project\s*\*?$/i)).toHaveValue('5')
    unmount()

    renderCart([item()])
    expect(screen.getByLabelText(/^project\s*\*?$/i)).toHaveValue('')
  })

  it('will not check out until a project is chosen', async () => {
    const user = userEvent.setup()
    renderCart([item()])

    expect(screen.getByRole('button', { name: /check out/i })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText(/^project\s*\*?$/i), '5')
    expect(screen.getByRole('button', { name: /check out/i })).toBeEnabled()
  })

  it('blocks checkout while an item is no longer offered, and says why', () => {
    // Checking out would fail the validation gate anyway; better to say so first.
    renderCart([item({ stillOffered: false })], [projects[0]])
    expect(screen.getByText(/no longer offered/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check out/i })).toBeDisabled()
  })

  it('loads the parameter definitions per item', async () => {
    mockedGet.mockResolvedValue({ parameters: [param()] } as never)
    renderCart([item(), item({ id: 2, productId: 11, environmentId: 3 })])

    // Definitions depend on the product AND environment pair, so one fetch each.
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2))
    expect(mockedGet).toHaveBeenCalledWith('/api/catalog/10?lang=en&environmentId=2', 't')
    expect(mockedGet).toHaveBeenCalledWith('/api/catalog/11?lang=en&environmentId=3', 't')
  })

  it('renders a parameter field per applicable definition', async () => {
    mockedGet.mockResolvedValue({ parameters: [param({ label: 'Hostname' })] } as never)
    renderCart([item()], [projects[0]])

    expect(await screen.findByLabelText(/hostname/i)).toBeInTheDocument()
  })

  it('excludes a definition scoped to another environment', async () => {
    mockedGet.mockResolvedValue({
      parameters: [param({ label: 'Mine', environmentId: 2 }), param({ id: 2, name: 'OTHER', label: 'Theirs', environmentId: 99 })],
    } as never)
    renderCart([item()], [projects[0]])

    expect(await screen.findByLabelText(/mine/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/theirs/i)).not.toBeInTheDocument()
  })

  it('still lets checkout proceed when the definitions fail to load', async () => {
    // The server validates regardless, so an unlabelled card beats a dead cart.
    mockedGet.mockRejectedValue(new Error('offline'))
    renderCart([item()], [projects[0]])

    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /check out/i })).toBeEnabled()
  })

  it('submits every item with its own parameters and cost centre', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({ parameters: [param()] } as never)
    renderCart([item(), item({ id: 2, productId: 11 })], [projects[0]])

    const first = screen.getByTestId('cart-item-1')
    await user.type(await within(first).findByLabelText(/hostname/i), 'web-01')
    await user.selectOptions(within(first).getByLabelText(/cost center/i), '20')
    await user.click(screen.getByRole('button', { name: /check out/i }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    const body = mockedPost.mock.calls[0][1] as {
      projectId: number
      items: { cartItemId: number; parameters: Record<string, string>; costCenterId?: number }[]
    }
    expect(body.projectId).toBe(5)
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toMatchObject({ cartItemId: 1, parameters: { HOST: 'web-01' }, costCenterId: 20 })
    // The second item got no cost centre, so none is sent for it.
    expect(body.items[1].costCenterId).toBeUndefined()
  })

  it('merges a definition default in for an untouched parameter', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({ parameters: [param({ defaultValue: 'eu-central-1' })] } as never)
    renderCart([item()], [projects[0]])

    await screen.findByLabelText(/hostname/i)
    await user.click(screen.getByRole('button', { name: /check out/i }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    const body = mockedPost.mock.calls[0][1] as { items: { parameters: Record<string, string> }[] }
    expect(body.items[0].parameters).toEqual({ HOST: 'eu-central-1' })
  })

  it('goes to the orders list on a clean checkout', async () => {
    const user = userEvent.setup()
    renderCart([item()], [projects[0]])

    await user.click(screen.getByRole('button', { name: /check out/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders'))
  })

  it('keeps the failed items and names them on a partial checkout', async () => {
    // Some pipelines may already be running, so this is not an error to retry
    // wholesale — the user needs to know which items are still theirs to deal with.
    const user = userEvent.setup()
    mockedPost.mockResolvedValue({
      orderIds: [1],
      failed: [{ cartItemId: 2, message: 'CI unreachable' }],
    } as CheckoutResponse as never)
    renderCart([item(), item({ id: 2 })], [projects[0]])

    await user.click(screen.getByRole('button', { name: /check out/i }))

    expect(await screen.findByText(/some items were not ordered/i)).toBeInTheDocument()
    expect(screen.getByText(/CI unreachable/)).toBeInTheDocument()
    // Only the failed item remains.
    expect(screen.queryByTestId('cart-item-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('cart-item-2')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('surfaces the validation gate\'s refusal without emptying the cart', async () => {
    const user = userEvent.setup()
    mockedPost.mockRejectedValue(new Error('Nothing was ordered. 1 item(s) need attention: #2: Missing required parameter: SIZE'))
    renderCart([item(), item({ id: 2 })], [projects[0]])

    await user.click(screen.getByRole('button', { name: /check out/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was ordered/i)
    expect(screen.getByTestId('cart-item-1')).toBeInTheDocument()
    expect(screen.getByTestId('cart-item-2')).toBeInTheDocument()
  })

  it('removes one item', async () => {
    const user = userEvent.setup()
    renderCart([item(), item({ id: 2 })])

    await user.click(within(screen.getByTestId('cart-item-1')).getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith('/api/cart/1', 't'))
    await waitFor(() => expect(screen.queryByTestId('cart-item-1')).not.toBeInTheDocument())
    expect(screen.getByTestId('cart-item-2')).toBeInTheDocument()
  })

  it('empties the cart', async () => {
    const user = userEvent.setup()
    renderCart([item(), item({ id: 2 })])

    await user.click(screen.getByRole('button', { name: /empty cart/i }))
    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith('/api/cart', 't'))
    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument()
  })

  it('keeps the item when removing it fails', async () => {
    const user = userEvent.setup()
    mockedDel.mockRejectedValue(new Error('offline'))
    renderCart([item()])

    await user.click(within(screen.getByTestId('cart-item-1')).getByRole('button', { name: /remove/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('cart-item-1')).toBeInTheDocument()
  })

  it('shows the item count on the checkout button', () => {
    renderCart([item(), item({ id: 2 }), item({ id: 3 })], [projects[0]])
    expect(screen.getByRole('button', { name: /check out \(3\)/i })).toBeInTheDocument()
  })
})
