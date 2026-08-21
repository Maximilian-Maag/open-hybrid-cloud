import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { AxeResults } from 'axe-core'
import { Alert } from './ui/Alert'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Select } from './ui/Select'
import { StatusBadge } from './ui/StatusBadge'
import { Table } from './ui/Table'

/**
 * Component-level accessibility checks (issue #102).
 *
 * The e2e gate scans pages, which means a component is only checked if some page
 * in that list happens to render it in the state that would fail. That is how the
 * dialogs went unchecked until they were added by hand, and it is why a
 * regression in a primitive can reach main: nothing here ran axe at all.
 *
 * These are cheap — no browser, no server — and they check the state, not the
 * page: a select with an error, a modal that is open, a button that is only text.
 *
 * What jsdom cannot do is `color-contrast`, which needs real layout; axe reports
 * it as "incomplete" rather than a violation, and the e2e gate is where contrast
 * is actually enforced. Everything structural — labelling, roles, name
 * computation, aria references — is exactly what this catches.
 */

// jsdom does not implement the native <dialog> methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
})

/**
 * Axe over a rendered component.
 *
 * Landmark and region rules are switched off: they are properties of a page, and
 * a component rendered on its own is "not in a landmark" by construction. Leaving
 * them on would report the same non-finding for every component here and train
 * the reader to ignore the output.
 */
const check = async (ui: React.ReactElement): Promise<AxeResults> => {
  const { container } = render(ui)
  return (await axe(container, {
    rules: {
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
      // Needs real layout and a canvas, neither of which jsdom has — it would
      // report "incomplete" and log a getContext warning per run. Contrast is
      // enforced in the e2e gate, against a real browser and the real palette.
      'color-contrast': { enabled: false },
    },
  })) as AxeResults
}

describe('the check itself', () => {
  it('reports a violation when there is one', async () => {
    // Without this the suite is a rubber stamp: `toHaveNoViolations` passes on a
    // matcher that was never registered, which is exactly what happened while
    // this was being written (vitest-axe's extend-expect entry point is empty).
    const results = await check(<input type="text" />)
    expect(results.violations.length).toBeGreaterThan(0)
    expect(results.violations.map((v) => v.id)).toContain('label')
  })
})

describe('Alert', () => {
  it('is accessible in every tone', async () => {
    for (const tone of ['error', 'success', 'warning', 'info'] as const) {
      expect(await check(<Alert tone={tone}>Something happened</Alert>)).toHaveNoViolations()
    }
  })
})

describe('Button', () => {
  it('is accessible in every variant', async () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost'] as const) {
      expect(await check(<Button variant={variant}>Save</Button>)).toHaveNoViolations()
    }
  })

  it('has an accessible name when it is icon-only', async () => {
    // An icon-only control with no name is the classic failure, and #99 was a
    // near miss of the same kind.
    expect(
      await check(
        <Button aria-label="Remove from favorites">
          <svg aria-hidden="true" viewBox="0 0 24 24" />
        </Button>,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible while disabled and busy', async () => {
    expect(await check(<Button disabled>Saving…</Button>)).toHaveNoViolations()
  })
})

describe('Input', () => {
  it('is accessible with a label alone', async () => {
    expect(await check(<Input label="Hostname" />)).toHaveNoViolations()
  })

  it('is accessible with a hint and with an error', async () => {
    expect(await check(<Input label="Hostname" hint="Sent as TF_VAR_hostname" />)).toHaveNoViolations()
    expect(await check(<Input label="Hostname" error="Required" required />)).toHaveNoViolations()
  })
})

describe('Select', () => {
  const options = [
    { value: 'aws', label: 'AWS Frankfurt' },
    { value: 'vsphere', label: 'On-Premise Vienna' },
  ]

  it('is accessible with options alone', async () => {
    expect(await check(<Select label="Environment" options={options} />)).toHaveNoViolations()
  })

  it('is accessible with a placeholder', async () => {
    // The placeholder is a disabled option, which is the shape that has caught
    // people out before — worth asserting it is not also an a11y problem.
    expect(
      await check(<Select label="Environment" options={options} placeholder="Choose one" />),
    ).toHaveNoViolations()
  })

  it('is accessible with an error and with a hint', async () => {
    expect(await check(<Select label="Environment" options={options} error="Pick one" />)).toHaveNoViolations()
    expect(await check(<Select label="Environment" options={options} hint="Where it runs" />)).toHaveNoViolations()
  })
})

describe('Modal', () => {
  it('is accessible when open with a title', async () => {
    expect(
      await check(
        <Modal open onClose={() => {}} title="Confirm delete">
          <p>This cannot be undone.</p>
        </Modal>,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible when named by aria-label instead of a visible title', async () => {
    expect(
      await check(
        <Modal open onClose={() => {}} ariaLabel="Edit product">
          <Input label="Name" />
        </Modal>,
      ),
    ).toHaveNoViolations()
  })
})

describe('Card', () => {
  it('is accessible with a title and an action', async () => {
    expect(
      await check(
        <Card title="Cost centres" action={<Button>Add</Button>}>
          <p>Body</p>
        </Card>,
      ),
    ).toHaveNoViolations()
  })
})

describe('StatusBadge', () => {
  it('is accessible for every status it renders', async () => {
    for (const status of ['pending', 'provisioning', 'completed', 'failed', 'active', 'decommissioned'] as const) {
      expect(await check(<StatusBadge status={status} />)).toHaveNoViolations()
    }
  })
})

describe('Table', () => {
  type Row = { id: number; name: string }
  const columns = [
    { header: 'Name', accessor: 'name' as const },
    { header: 'Actions', render: (row: Row) => <Button aria-label={`Edit ${row.name}`}>Edit</Button> },
  ]

  it('is accessible with rows', async () => {
    expect(
      await check(<Table columns={columns} data={[{ id: 1, name: 'web-01' }]} />),
    ).toHaveNoViolations()
  })

  it('is accessible when empty', async () => {
    expect(
      await check(<Table columns={columns} data={[]} emptyMessage="Nothing yet" />),
    ).toHaveNoViolations()
  })
})
