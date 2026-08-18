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
    { productId: 7, environmentId: 1, price: '0', currency: 'EUR', costCenterMode: 'project', forcedCostCenter: false, overheadCostCenterId: null, environmentName: 'Env One' },
    { productId: 7, environmentId: 2, price: '0', currency: 'EUR', costCenterMode: 'project', forcedCostCenter: false, overheadCostCenterId: null, environmentName: 'Env Two' },
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

  // ── Cost-centre modes (FA-10.4) ───────────────────────────────────────────
  // `overhead` names a fixed shared account on the offering. Before it had
  // somewhere to store one it was lumped in with `select` and rendered a
  // picker, so a fixed overhead account was indistinguishable from a free
  // choice.
  const envWithMode = (
    mode: 'project' | 'select' | 'overhead',
    over?: { overheadCostCenterId?: number | null; overheadCostCenterName?: string | null; forcedCostCenter?: boolean },
  ) => ({
    ...product,
    environments: [{
      productId: 7,
      environmentId: 1,
      price: '0',
      currency: 'EUR',
      costCenterMode: mode,
      forcedCostCenter: over?.forcedCostCenter ?? false,
      overheadCostCenterId: over?.overheadCostCenterId ?? null,
      overheadCostCenterName: over?.overheadCostCenterName ?? null,
      environmentName: 'Env One',
    }],
  } as unknown as ProductDetail)

  const costCenters = [
    { id: 10, code: 'CC-100', name: 'Shared Platform', active: true },
  ] as never

  // The env-scoped refetch has to return a product-shaped payload — the
  // component reads `.parameters` off it.
  const mockCatalogFor = (detail: ProductDetail) => {
    mockedGet.mockImplementation((async (path: string) =>
      path.startsWith('/api/catalog/') ? detail : []) as never)
  }

  it('offers a cost-centre picker in select mode', async () => {
    const detail = envWithMode('select')
    mockCatalogFor(detail)
    render(<OrderForm product={detail} projects={[]} costCenters={costCenters} token="t" />)
    await userEvent.selectOptions(screen.getByLabelText(/environment/i), '1')

    expect(await screen.findByLabelText(/^cost center/i)).toBeInTheDocument()
    expect(screen.queryByTestId('overhead-cost-center')).not.toBeInTheDocument()
  })

  it('shows the fixed account instead of a picker in overhead mode', async () => {
    const detail = envWithMode('overhead', { overheadCostCenterId: 10, overheadCostCenterName: 'Shared Platform' })
    mockCatalogFor(detail)
    render(<OrderForm product={detail} projects={[]} costCenters={costCenters} token="t" />)
    await userEvent.selectOptions(screen.getByLabelText(/environment/i), '1')

    expect(await screen.findByTestId('overhead-cost-center')).toHaveTextContent('Shared Platform')
    // No picker: the account is fixed by the offering, so there is nothing to choose.
    expect(screen.queryByLabelText(/^cost center/i)).not.toBeInTheDocument()
  })

  it('renders a placeholder when an overhead offering has no account configured', async () => {
    const detail = envWithMode('overhead')
    mockCatalogFor(detail)
    render(<OrderForm product={detail} projects={[]} costCenters={costCenters} token="t" />)
    await userEvent.selectOptions(screen.getByLabelText(/environment/i), '1')

    expect(await screen.findByTestId('overhead-cost-center')).toHaveTextContent('—')
  })

  it('shows no cost-centre control at all in project mode', async () => {
    const detail = envWithMode('project')
    mockCatalogFor(detail)
    render(<OrderForm product={detail} projects={[]} costCenters={costCenters} token="t" />)
    await userEvent.selectOptions(screen.getByLabelText(/environment/i), '1')

    expect(screen.queryByLabelText(/^cost center/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('overhead-cost-center')).not.toBeInTheDocument()
  })
})
