import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProductDetail } from '@open-hybrid-cloud/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

import { OrderForm } from './OrderForm'
import { get } from '@/lib/api'

const mockedGet = vi.mocked(get)

const param = (over: Partial<ProductDetail['parameters'][number]>) => ({
  id: 1,
  scope: 'global' as const,
  scopeId: 0,
  environmentId: null,
  name: 'REGION',
  label: '',
  type: 'string' as const,
  description: '',
  defaultValue: '',
  required: false,
  sensitive: false,
  ...over,
})

// The catalog page loads the product WITHOUT an environment, so the server can
// only return one candidate per name per environment: here the all-environments
// definition of REGION plus an env-2 override of the same name.
const product = {
  id: 7,
  categoryId: 1,
  baseLanguage: 'en',
  createdAt: new Date().toISOString(),
  name: 'P',
  description: '',
  environments: [
    { productId: 7, environmentId: 1, price: '0', currency: 'EUR', costCenterMode: 'project', forcedCostCenter: false, environmentName: 'Env One' },
    { productId: 7, environmentId: 2, price: '0', currency: 'EUR', costCenterMode: 'project', forcedCostCenter: false, environmentName: 'Env Two' },
  ],
  parameters: [
    param({ id: 1, name: 'REGION', environmentId: null, label: 'Region (all envs)' }),
    param({ id: 2, name: 'REGION', environmentId: 2, scope: 'product', scopeId: 7, label: 'Region (env two)' }),
  ],
} as unknown as ProductDetail

beforeEach(() => {
  mockedGet.mockReset()
  // Templates lookup (fired on project selection) — not exercised here.
  mockedGet.mockResolvedValue([] as never)
})

describe('OrderForm parameter resolution', () => {
  it('refetches the product scoped to the selected environment and renders that resolution', async () => {
    // What the server resolves for env 1: the all-environments definition wins,
    // because the only override belongs to env 2.
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog/')) {
        return { ...product, parameters: [param({ id: 1, name: 'REGION', environmentId: null, label: 'Region (all envs)' })] }
      }
      return []
    }) as never)

    render(<OrderForm product={product} projects={[]} costCenters={[]} token="t" />)

    await userEvent.selectOptions(screen.getByLabelText(/environment/i), '1')

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/api/catalog/7?lang=en&environmentId=1', 't')
    })

    // Exactly one REGION control, and it is the definition createOrder will
    // validate against for env 1 — not the env-2 override that would have won a
    // name-only collapse on the server.
    await waitFor(() => {
      expect(screen.getByLabelText('Region (all envs)')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Region (env two)')).not.toBeInTheDocument()
  })

  it('falls back to the unresolved list when the scoped refetch fails', async () => {
    mockedGet.mockImplementation((async (path: string) => {
      if (path.startsWith('/api/catalog/')) throw new Error('offline')
      return []
    }) as never)

    render(<OrderForm product={product} projects={[]} costCenters={[]} token="t" />)

    await userEvent.selectOptions(screen.getByLabelText(/environment/i), '2')

    // The env-2 candidate is still rendered from the initially-loaded list, so a
    // failed refetch degrades rather than blanking the form.
    await waitFor(() => {
      expect(screen.getByLabelText('Region (env two)')).toBeInTheDocument()
    })
  })
})
