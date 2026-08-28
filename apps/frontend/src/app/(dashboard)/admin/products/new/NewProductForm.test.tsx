import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Category, DeploymentEnvironment } from '@open-hybrid-cloud/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

const post = vi.fn()
const get = vi.fn()
vi.mock('@/lib/api', () => ({
  post: (...a: unknown[]) => post(...a),
  get: (...a: unknown[]) => get(...a),
  PROXY_PREFIX: '/api/proxy',
}))

import { NewProductForm } from './NewProductForm'

const categories: Category[] = [{ id: 3, name: 'Compute', displayOrder: 0 }]
const environments: DeploymentEnvironment[] = [
  { id: 7, name: 'Linode' } as unknown as DeploymentEnvironment,
]

beforeEach(() => {
  vi.clearAllMocks()
  get.mockImplementation(async (url: string) => {
    if (url === '/api/admin/ci-sources') return [{ id: 1, name: 'GitLab' }]
    if (url.endsWith('/projects')) return [{ id: '42', fullPath: 'infra/templates' }]
    if (url.endsWith('/branches')) return [{ name: 'main' }]
    return []
  })
  post.mockResolvedValue({ id: 99 })
})

const fill = async () => {
  await userEvent.selectOptions(screen.getByLabelText(/category/i), '3')
  await userEvent.type(screen.getByLabelText(/^name/i), 'Kubernetes Cluster')
  await userEvent.type(screen.getByLabelText(/description/i), 'A cluster')
}

/**
 * Creating a product FROM a template (#248).
 *
 * The import endpoint is keyed by an existing product id, so this cannot be part
 * of the create call — it runs straight after, the way the image upload does.
 * What it buys is the sequence the issue said nothing on either screen explained:
 * create, then a pipeline stack, then parameters, all on one submit.
 */
describe('NewProductForm, building from a template', () => {
  it('does not ask for a template unless asked to', () => {
    render(<NewProductForm categories={categories} environments={environments} />)
    expect(screen.queryByLabelText(/ci source/i)).toBeNull()
  })

  it('reveals the coordinates when opened, and loads the sources', async () => {
    render(<NewProductForm categories={categories} environments={environments} />)

    await userEvent.click(screen.getByLabelText(/build it from a template/i))

    expect(screen.getByLabelText(/ci source/i)).toBeInTheDocument()
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/admin/ci-sources'))
  })

  // Half-filled coordinates would 400 at the endpoint after the product had
  // already been created, which is the worst moment to find out.
  it('will not submit with the template half-filled', async () => {
    render(<NewProductForm categories={categories} environments={environments} />)
    await fill()
    await userEvent.click(screen.getByLabelText(/build it from a template/i))

    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
  })

  it('creates the product, then imports the template into it', async () => {
    render(<NewProductForm categories={categories} environments={environments} />)
    await fill()
    await userEvent.click(screen.getByLabelText(/build it from a template/i))

    await waitFor(() => expect(screen.getByLabelText(/ci source/i)).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText(/ci source/i), '1')
    await waitFor(() => expect(screen.getByLabelText(/repository/i)).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText(/repository/i), '42')
    await waitFor(() => expect(screen.getByLabelText(/branch/i)).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText(/branch/i), 'main')
    await userEvent.type(screen.getByLabelText(/template path/i), 'templates/linode/kubernetes-cluster')

    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    // The product first, because the import is keyed by its id.
    expect(post.mock.calls[0][0]).toBe('/api/admin/products')
    expect(post.mock.calls[1][0]).toBe('/api/admin/products/99/import-parameters')
    expect(post.mock.calls[1][1]).toMatchObject({
      ciSourceId: 1,
      projectId: '42',
      ref: 'main',
      path: 'templates/linode/kubernetes-cluster',
      // The environment is what turns the import into a pipeline stack, and a
      // single environment is preselected because there is no choice to make.
      environmentId: 7,
    })
    expect(push).toHaveBeenCalledWith('/admin/products/99')
  })

  /*
   * A failed import must not lose the product that was just created. The edit
   * page can retry an import; it cannot un-lose a product. So the message is
   * carried over and the redirect still happens.
   */
  it('keeps the product when the import fails, and says why', async () => {
    post.mockImplementation(async (url: string) => {
      if (url === '/api/admin/products') return { id: 99 }
      throw new Error('Could not read templates/nope at main')
    })

    render(<NewProductForm categories={categories} environments={environments} />)
    await fill()
    await userEvent.click(screen.getByLabelText(/build it from a template/i))
    await waitFor(() => expect(screen.getByLabelText(/ci source/i)).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText(/ci source/i), '1')
    await waitFor(() => expect(screen.getByLabelText(/repository/i)).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText(/repository/i), '42')
    await waitFor(() => expect(screen.getByLabelText(/branch/i)).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText(/branch/i), 'main')

    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(push.mock.calls[0][0]).toMatch(/^\/admin\/products\/99\?imageError=/)
    expect(decodeURIComponent(push.mock.calls[0][0])).toMatch(/Could not read templates\/nope/)
  })

  it('creates the product alone when the template is not asked for', async () => {
    render(<NewProductForm categories={categories} environments={environments} />)
    await fill()

    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][0]).toBe('/api/admin/products')
  })
})
