import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
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
// Not primitives, but the same argument applies: a chart is drawn markup, and the
// page-level gate only catches it in whatever state that page happens to render.
import { CostTrend } from '@/app/(dashboard)/costs/CostTrend'
import { CostDistribution } from '@/app/(dashboard)/costs/CostDistribution'
import { CostComparison } from '@/app/(dashboard)/costs/CostComparison'
import { DelegationPanel } from '@/app/(dashboard)/approvals/DelegationPanel'
import { ActiveSessions } from './forms/ActiveSessions'
import type { SessionInfo } from '@open-hybrid-cloud/types'

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

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ post: vi.fn(), del: vi.fn() }))

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

/**
 * The cost charts (issue #106).
 *
 * An SVG is the easiest thing in this app to render inaccessibly: a picture with no
 * name, encoding everything by colour, with the numbers nowhere but the shapes. The
 * checks below are the three that would catch that — the chart has a name, the data
 * is present as text, and axe finds nothing structural — and they run against the
 * empty, single-period and folded-tail states, because those take different paths.
 *
 * Contrast is not checked here (jsdom has no layout, and the fills come from CSS
 * variables the dashboard layout sets). The ramp's 3:1 floor is asserted directly in
 * lib/contrast.test.ts, and the painted result in the e2e axe gate.
 */
const money = (eur: number) => `${eur.toFixed(2)} EUR`
const period = (p: string, totalEur: number, partial = false) => ({
  period: p,
  totalEur,
  orderCount: 1,
  estimatedOrders: 0,
  partial,
})
const bucket = (id: number, label: string, totalEur: number) => ({
  id,
  label,
  totalEur,
  orderCount: 1,
})

describe('CostTrend', () => {
  const series = [period('2026-06', 120), period('2026-07', 0), period('2026-08', 90, true)]

  it('is accessible with a series', async () => {
    expect(
      await check(
        <CostTrend series={series} money={money} lang="en" estimatedOrders={0} unconverted={[]} />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible with the caveats attached and an empty series', async () => {
    expect(
      await check(
        <CostTrend
          series={[]}
          money={money}
          lang="en"
          estimatedOrders={3}
          unconverted={[{ currency: 'JPY', amount: 100 }]}
        />,
      ),
    ).toHaveNoViolations()
  })

  it('gives the picture an accessible name', async () => {
    // Without one the chart is an unlabelled graphic — the svg-img-alt failure.
    render(<CostTrend series={series} money={money} lang="en" estimatedOrders={0} unconverted={[]} />)
    expect(screen.getByRole('img', { name: /spend over time/i })).toBeTruthy()
  })
})

describe('CostDistribution', () => {
  const buckets = [bucket(1, 'Webshop', 60), bucket(2, 'Intranet', 40)]

  it('is accessible with a share bar and legend', async () => {
    expect(
      await check(
        <CostDistribution
          chartId="a11y-share"
          dimension="Per project"
          buckets={buckets}
          money={money}
          lang="en"
          estimatedOrders={0}
          unconverted={[]}
        />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible when the tail is folded into Other', async () => {
    const many = Array.from({ length: 12 }, (_, i) => bucket(i + 1, `Project ${i + 1}`, 12 - i))
    expect(
      await check(
        <CostDistribution
          chartId="a11y-share-many"
          dimension="Per project"
          buckets={many}
          money={money}
          lang="en"
          estimatedOrders={1}
          unconverted={[]}
        />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible with nothing to show', async () => {
    expect(
      await check(
        <CostDistribution
          chartId="a11y-share-empty"
          dimension="Per project"
          buckets={[]}
          money={money}
          lang="en"
          estimatedOrders={0}
          unconverted={[]}
        />,
      ),
    ).toHaveNoViolations()
  })
})

describe('CostComparison', () => {
  const comparison = {
    previous: period('2026-07', 40),
    current: period('2026-08', 50, true),
    changeEur: 10,
    changePct: 25,
  }

  it('is accessible with a comparison', async () => {
    expect(
      await check(
        <CostComparison
          comparison={comparison}
          money={money}
          lang="en"
          estimatedOrders={0}
          unconverted={[]}
        />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible when the window is too short to compare', async () => {
    expect(
      await check(
        <CostComparison
          comparison={null}
          money={money}
          lang="en"
          estimatedOrders={0}
          unconverted={[]}
        />,
      ),
    ).toHaveNoViolations()
  })
})

/**
 * Approval delegation (issue #35).
 *
 * Not a `ui/` primitive, but it is a form the e2e gate only ever sees in its
 * empty state — the "you are approving on behalf of X" banner and the granted
 * list only appear when there are delegations, and no seeded dev database has
 * any. Both states are checked here instead.
 */
describe('DelegationPanel', () => {
  const candidates = [{ id: 2, name: 'Bob Admin', email: 'bob@test.dev' }]
  const delegation = {
    id: 5,
    fromUserId: 1,
    fromUserName: 'Alice Admin',
    fromUserEmail: 'alice@test.dev',
    toUserId: 2,
    toUserName: 'Bob Admin',
    toUserEmail: 'bob@test.dev',
    startsOn: '2026-09-01',
    endsOn: '2026-09-14',
    createdAt: '2026-08-20T10:00:00.000Z',
    revokedAt: null,
    active: true,
  }

  it('is accessible as the empty create form', async () => {
    expect(
      await check(
        <DelegationPanel
          delegations={{ mine: [], grantedToMe: [], candidates }}
          token="t"
        />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible while announcing a held authority and listing a granted one', async () => {
    expect(
      await check(
        <DelegationPanel
          delegations={{ mine: [delegation], grantedToMe: [delegation], candidates }}
          token="t"
        />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible when there is nobody to nominate', async () => {
    expect(
      await check(
        <DelegationPanel delegations={{ mine: [], grantedToMe: [], candidates: [] }} token="t" />,
      ),
    ).toHaveNoViolations()
  })
})

describe('ActiveSessions', () => {
  const session = (over: Partial<SessionInfo>): SessionInfo => ({
    id: 1,
    userId: 1,
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0',
    createdAt: '2026-08-20T09:00:00.000Z',
    lastSeenAt: '2026-08-21T11:30:00.000Z',
    expiresAt: '2026-08-21T17:00:00.000Z',
    current: false,
    ...over,
  })

  it('is accessible with the current session and another device', async () => {
    // Five "Sign out" buttons with the same visible label is the failure this
    // guards: each one carries an aria-label naming its row (#37).
    expect(
      await check(
        <ActiveSessions
          token="t"
          initialSessions={[
            session({ id: 1, current: true }),
            session({ id: 2, userAgent: 'Mozilla/5.0 (iPhone) Safari/605', ip: '198.51.100.4' }),
          ]}
        />,
      ),
    ).toHaveNoViolations()
  })

  it('is accessible with nothing to show', async () => {
    expect(await check(<ActiveSessions token="t" initialSessions={[]} />)).toHaveNoViolations()
  })

  it('is accessible when a session recorded neither ip nor user agent', async () => {
    // Both columns are nullable — no trusted proxy, or a client that sends no
    // User-Agent — so the em-dash placeholder has to be checked too.
    expect(
      await check(
        <ActiveSessions
          token="t"
          initialSessions={[session({ id: 3, ip: null, userAgent: null, current: true })]}
        />,
      ),
    ).toHaveNoViolations()
  })
})
