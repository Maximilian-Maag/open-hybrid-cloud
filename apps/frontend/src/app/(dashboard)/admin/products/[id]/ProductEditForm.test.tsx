import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProductDetail, Category, DeploymentEnvironment, CostCenter } from '@open-hybrid-cloud/types'

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
import { get, del, put } from '@/lib/api'

const mockedGet = vi.mocked(get)
const mockedDel = vi.mocked(del)
const mockedPut = vi.mocked(put)

const LINKED_ENV = 1
const UNLINKED_ENV = 2

const environments = [
  { id: LINKED_ENV, name: 'AWS Frankfurt' },
  { id: UNLINKED_ENV, name: 'On-Premise Vienna' },
] as unknown as DeploymentEnvironment[]

const costCenters: CostCenter[] = [
  { id: 10, code: 'CC-100', name: 'Shared Platform', active: true },
  { id: 11, code: 'CC-200', name: 'Retired Account', active: false },
]

const product = {
  id: 7,
  categoryId: 1,
  baseLanguage: 'en',
  createdAt: new Date().toISOString(),
  name: 'Managed Postgres',
  description: '',
  // Only AWS Frankfurt is offered — On-Premise Vienna is listed but unlinked.
  environments: [
    { productId: 7, environmentId: LINKED_ENV, price: '12.00', currency: 'EUR', costCenterMode: 'project', forcedCostCenter: false, overheadCostCenterId: null, trialEnabled: false, trialDurationMinutes: 30 },
  ],
  parameters: [],
} as unknown as ProductDetail

const renderForm = (over?: Partial<ProductDetail>) =>
  render(
    <ProductEditForm
      product={{ ...product, ...over }}
      categories={[{ id: 1, name: 'Databases', displayOrder: 0 }] as Category[]}
      environments={environments}
      translations={[]}
      costCenters={costCenters}
     
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

describe('ProductEditForm overhead cost centre', () => {
  const overheadProduct = (overheadCostCenterId: number | null, forcedCostCenter = false) => ({
    environments: [
      {
        productId: 7,
        environmentId: LINKED_ENV,
        price: '12.00',
        currency: 'EUR',
        costCenterMode: 'overhead',
        forcedCostCenter,
        overheadCostCenterId,
      },
    ],
  } as unknown as Partial<ProductDetail>)

  const envRow = () => {
    const row = screen.getAllByRole('button', { name: 'Remove' })[0].closest('form')
    if (!row) throw new Error('environment row not found')
    return row
  }

  it('hides the overhead picker for modes that do not use it', () => {
    renderForm() // 'project' mode
    expect(screen.queryByLabelText(/overhead cost center/i)).not.toBeInTheDocument()
  })

  it('shows the picker when the mode is switched to overhead', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.selectOptions(within(envRow()).getByLabelText(/cost center mode/i), 'overhead')
    expect(await screen.findByLabelText(/overhead cost center/i)).toBeInTheDocument()
  })

  it('preselects the stored account and offers only active ones', () => {
    renderForm(overheadProduct(10))

    const picker = screen.getByLabelText(/overhead cost center/i)
    expect(picker).toHaveValue('10')
    expect(within(picker).getByRole('option', { name: /CC-100/ })).toBeInTheDocument()
    // The inactive account is not offered — ordering would reject it anyway.
    expect(within(picker).queryByRole('option', { name: /CC-200/ })).not.toBeInTheDocument()
  })

  it('still offers an already-stored account that has since been deactivated', () => {
    // Otherwise the picker would silently show a blank selection and a Save
    // would clear the configuration the operator never touched.
    renderForm(overheadProduct(11))

    const picker = screen.getByLabelText(/overhead cost center/i)
    expect(picker).toHaveValue('11')
    expect(within(picker).getByRole('option', { name: /CC-200 — Retired Account \(inactive\)/ })).toBeInTheDocument()
  })

  it('warns that a forced overhead offering rejects orders until an account is chosen', () => {
    renderForm(overheadProduct(null, true))
    expect(screen.getByText(/orders in this environment are rejected/i)).toBeInTheDocument()
  })

  it('saves the chosen account, and clears it when the mode moves away from overhead', async () => {
    const user = userEvent.setup()
    mockedPut.mockReset().mockResolvedValue(undefined as never)
    renderForm(overheadProduct(null))

    const row = envRow()
    await user.selectOptions(screen.getByLabelText(/overhead cost center/i), '10')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut.mock.calls[0][1]).toMatchObject({
      costCenterMode: 'overhead',
      overheadCostCenterId: 10,
    })

    // Switching to a mode that never uses the account must not leave it stored,
    // or flipping back to overhead would silently resurrect it.
    await user.selectOptions(within(row).getByLabelText(/cost center mode/i), 'select')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(2))
    expect(mockedPut.mock.calls[1][1]).toMatchObject({
      costCenterMode: 'select',
      overheadCostCenterId: null,
    })
  })
})

// Issue #1. Trials are opt-in per offering, so the duration field only appears
// once the offering has actually been opted in.
describe('ProductEditForm trial configuration', () => {
  const envRow = () => {
    const row = screen.getAllByRole('button', { name: 'Remove' })[0].closest('form')
    if (!row) throw new Error('environment row not found')
    return row
  }

  const trialProduct = (trialEnabled: boolean, trialDurationMinutes = 30) => ({
    environments: [
      {
        productId: 7,
        environmentId: LINKED_ENV,
        price: '12.00',
        currency: 'EUR',
        costCenterMode: 'project',
        forcedCostCenter: false,
        overheadCostCenterId: null,
        trialEnabled,
        trialDurationMinutes,
      },
    ],
  } as unknown as Partial<ProductDetail>)

  it('hides the duration field until the offering is opted in', async () => {
    const user = userEvent.setup()
    renderForm()
    expect(screen.queryByLabelText(/trial duration/i)).not.toBeInTheDocument()

    await user.click(within(envRow()).getByLabelText(/offer as trial/i))
    expect(await screen.findByLabelText(/trial duration/i)).toBeInTheDocument()
  })

  it('prefills the stored flag and duration', () => {
    renderForm(trialProduct(true, 120))
    expect(within(envRow()).getByLabelText(/offer as trial/i)).toBeChecked()
    expect(screen.getByLabelText(/trial duration/i)).toHaveValue(120)
  })

  it('saves the flag and duration', async () => {
    const user = userEvent.setup()
    mockedPut.mockReset().mockResolvedValue(undefined as never)
    renderForm(trialProduct(true, 30))

    const row = envRow()
    await user.clear(screen.getByLabelText(/trial duration/i))
    await user.type(screen.getByLabelText(/trial duration/i), '45')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut.mock.calls[0][1]).toMatchObject({ trialEnabled: true, trialDurationMinutes: 45 })
  })

  it('falls back to 30 rather than sending a cleared duration', async () => {
    // The server rejects a non-positive duration, which would surface as a
    // confusing save error on a field the operator may not have meant to empty.
    const user = userEvent.setup()
    mockedPut.mockReset().mockResolvedValue(undefined as never)
    renderForm(trialProduct(true, 30))

    const row = envRow()
    await user.clear(screen.getByLabelText(/trial duration/i))
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut.mock.calls[0][1]).toMatchObject({ trialDurationMinutes: 30 })
  })
})

describe('ProductEditForm order callbacks', () => {
  const webhook = {
    id: 1,
    productId: 7,
    environmentId: LINKED_ENV,
    name: 'Ticketing webhook',
    webhookUrl: 'https://example.com/hook',
    execOrder: 0,
  }

  it('loads the existing callbacks on mount, same as the pipeline stacks list', async () => {
    // Before the fix, `webhooks` was only ever written by add/delete — the
    // GET this endpoint exists for was never called, so a reload made every
    // existing callback invisible and its Delete button unreachable (#145).
    mockedGet.mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/admin/products/7/webhooks') return [webhook]
      return [] // pipeline-stacks
    }) as never)

    renderForm()

    expect(await screen.findByText('Ticketing webhook')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    expect(screen.queryByText('No callbacks configured.')).not.toBeInTheDocument()
    expect(mockedGet).toHaveBeenCalledWith('/api/admin/products/7/webhooks')
  })

  it('makes the loaded callback deletable', async () => {
    mockedGet.mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/admin/products/7/webhooks') return [webhook]
      return []
    }) as never)
    const user = userEvent.setup()
    renderForm()

    const card = (await screen.findByText('Ticketing webhook')).closest('div')?.parentElement
    if (!card) throw new Error('webhook row not found')
    await user.click(within(card).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith('/api/admin/products/7/webhooks/1'))
    await waitFor(() => expect(screen.queryByText('Ticketing webhook')).not.toBeInTheDocument())
  })
})

describe('ProductEditForm translations', () => {
  const german = {
    productId: 7,
    languageCode: 'de',
    name: 'Verwaltetes Postgres',
    description: 'Eine betreute Datenbank.',
    longDescription: 'Die lange Fassung, von Hand geschrieben.',
  }

  const formWith = (translations: typeof german[]) => (
    <ProductEditForm
      product={product}
      categories={[{ id: 1, name: 'Databases', displayOrder: 0 }] as Category[]}
      environments={environments}
      translations={translations}
      costCenters={costCenters}
     
    />
  )

  const renderWithTranslations = (translations = [german]) => render(formWith(translations))

  // Modal renders its children whether or not it is open, and "Name" and "Save"
  // label something in four other forms on this page — so every query here is
  // scoped to the translation dialog, anchored on the one field only it has.
  const dialog = () => {
    const box = screen.getByLabelText(/^long description/i)
    const found = box.closest('dialog')
    if (!found) throw new Error('translation modal not found')
    return found as HTMLElement
  }
  const longDesc = () => within(dialog()).getByLabelText(/^long description/i)
  // "Name *" in the DOM: Input appends a required marker inside the label.
  const name = () => within(dialog()).getByLabelText(/^name/i)
  const openModal = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Add Translation' }))
  const save = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(within(dialog()).getByRole('button', { name: 'Save' }))

  beforeEach(() => {
    mockedPut.mockReset().mockResolvedValue(undefined as never)
  })

  it('loads an existing translation into the modal instead of opening blank', async () => {
    const user = userEvent.setup()
    renderWithTranslations()

    await openModal(user)

    expect(name()).toHaveValue(german.name)
    expect(within(dialog()).getByLabelText(/^description/i)).toHaveValue(german.description)
    expect(longDesc()).toHaveValue(german.longDescription)
  })

  it('keeps the long description when a translation is re-saved without touching it', async () => {
    // The erasure this covers: the modal opened blank, this form always sends
    // longDescription, so fixing a typo in the name wiped the prose the product
    // page shows.
    const user = userEvent.setup()
    renderWithTranslations()

    await openModal(user)
    await user.clear(name())
    await user.type(name(), 'Verwaltete Postgres')
    await save(user)

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut.mock.calls[0][1]).toMatchObject({
      name: 'Verwaltete Postgres',
      longDescription: german.longDescription,
    })
  })

  it('opens blank for a language that has no translation yet', async () => {
    const user = userEvent.setup()
    renderWithTranslations([])

    await openModal(user)

    expect(name()).toHaveValue('')
    expect(longDesc()).toHaveValue('')
  })

  it('re-points every field when the language is switched', async () => {
    const user = userEvent.setup()
    renderWithTranslations()

    await openModal(user)
    await user.selectOptions(within(dialog()).getByLabelText('Language'), 'fr')

    // French has nothing stored, so the German text must not be left behind for
    // the save to write under the wrong language.
    expect(name()).toHaveValue('')
    expect(longDesc()).toHaveValue('')

    await user.selectOptions(within(dialog()).getByLabelText('Language'), 'de')
    expect(longDesc()).toHaveValue(german.longDescription)
  })

  it('follows the server list after an AI run rather than saving over it', async () => {
    // handleAiTranslate calls router.refresh(), which hands this component new
    // props but leaves useState holding the pre-run list. A re-render with a new
    // prop stands in for that refresh here: the modal has to show what the AI
    // wrote, because the form always sends longDescription and would otherwise
    // save a blank over it.
    const user = userEvent.setup()
    const { rerender } = renderWithTranslations([])

    rerender(formWith([german]))
    await openModal(user)

    expect(name()).toHaveValue(german.name)
    expect(longDesc()).toHaveValue(german.longDescription)

    await save(user)
    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut.mock.calls[0][1]).toMatchObject({ longDescription: german.longDescription })
  })

  it('still sends an edited long description', async () => {
    const user = userEvent.setup()
    renderWithTranslations()

    await openModal(user)
    await user.clear(longDesc())
    await user.type(longDesc(), 'Eine neue Fassung.')
    await save(user)

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut.mock.calls[0][1]).toMatchObject({ longDescription: 'Eine neue Fassung.' })
  })
})
