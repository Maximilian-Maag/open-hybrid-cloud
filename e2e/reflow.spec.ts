import { test, expect } from '@playwright/test'
import { AUTHED_PAGES, PUBLIC_PAGES } from './pages'

/**
 * WCAG 2.1 SC 1.4.10 Reflow, measured.
 *
 * "Content can be presented without loss of information or functionality, and
 * without requiring scrolling in two dimensions" at 320 CSS px. It is a AA
 * criterion, the a11y gate claims AA — and that gate could not see this one:
 * axe has no reflow rule (reflow is a property of the rendered layout, not of
 * the DOM) and it ran only at 1280×720, the one width where the failure did not
 * exist. That is how a 349px overflow on every authenticated page shipped (#167).
 *
 * This file is the reason it cannot ship again. It runs under its own Playwright
 * project so the device emulation is declared in the config rather than buried
 * here — see the `mobile` project in playwright.config.ts.
 *
 * 320 is the criterion. 375 and 430 are added because they are what people
 * actually hold: a phone that reflows at 320 and not at 430 is not a thing that
 * happens by accident, but the two extra measurements cost one resize each and
 * they are what the bug report was written from.
 */

const WIDTHS = [320, 375, 430]

/**
 * The elements sticking out past the right edge, innermost first.
 *
 * Reporting the offenders rather than only the number: `scrollWidth is 669, want
 * <= 375` is a true statement that tells nobody which of ~2000 nodes to open.
 *
 * Two filters make the list short enough to read:
 *
 *  1. Anything inside a horizontally scrollable ancestor is skipped. Those are
 *     deliberate — the tables and TopNav scroll on purpose — and they cannot
 *     widen the document anyway, because the scroll container clips them.
 *  2. Only the innermost offenders are kept. Every ancestor of an overflowing
 *     element overflows too, so without this the report is the same finding
 *     repeated once per level up to <body>.
 */
const overflowingElements = (limit: number) => {
  const clientWidth = document.documentElement.clientWidth

  const scrolls = (el: HTMLElement): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
    }
    return false
  }

  const over = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    // 1px of slack: sub-pixel layout puts a full-width box at 375.004.
    if (r.right <= clientWidth + 1) return false
    return !scrolls(el)
  })

  return over
    .filter((el) => !over.some((other) => other !== el && el.contains(other)))
    .slice(0, limit)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = typeof el.className === 'string' ? el.className : ''
      return `${el.tagName.toLowerCase()} ${Math.round(r.left)}–${Math.round(r.right)} ` +
        `(${Math.round(r.right - clientWidth)}px past the edge) class="${cls.slice(0, 120)}"`
    })
}

/** How far past the viewport the document reaches, and what is doing it. */
const measure = async (page: import('@playwright/test').Page) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  const offenders = scrollWidth > clientWidth + 1 ? await page.evaluate(overflowingElements, 6) : []
  return { scrollWidth, clientWidth, offenders }
}

const expectNoReflow = async (page: import('@playwright/test').Page, path: string) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    const { scrollWidth, clientWidth, offenders } = await measure(page)
    expect(
      scrollWidth,
      `${path} at ${width}px scrolls sideways (${scrollWidth - clientWidth}px past the viewport):\n  ` +
        (offenders.join('\n  ') || '(no unclipped element found — check a fixed width or a min-width)'),
    ).toBeLessThanOrEqual(clientWidth + 1)
  }
}

/**
 * Wait for the page's own content before measuring.
 *
 * A dashboard page that is still streaming has none of the rows that overflow, so
 * measuring early passes for the wrong reason. `main h1, main h2` is the same
 * signal the target-size block in a11y.spec.ts waits on.
 */
const authedReady = (page: import('@playwright/test').Page) =>
  expect(page.locator('main h1, main h2').first()).toBeVisible({ timeout: 30_000 })

test.describe('Reflow (WCAG 1.4.10) — public pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of PUBLIC_PAGES) {
    test(`${path} does not scroll sideways on a phone`, async ({ page }) => {
      // `load`, not a content locator: neither of these pages fetches anything
      // after render, and neither has the markup the dashboard pages are waited
      // on — /login has no <main>, and /impressum collapses to a single line of
      // text with no heading when the operator has configured no imprint.
      await page.goto(path, { waitUntil: 'load' })
      await expectNoReflow(page, path)
    })
  }
})

test.describe('Reflow (WCAG 1.4.10) — authenticated pages', () => {
  for (const path of AUTHED_PAGES) {
    test(`${path} does not scroll sideways on a phone`, async ({ page }) => {
      await page.goto(path)
      await authedReady(page)
      await expectNoReflow(page, path)
    })
  }
})

test.describe('Reflow (WCAG 1.4.10) — dialogs', () => {
  // Most of this app's forms live inside a <dialog>, which is positioned by the
  // browser rather than laid out in the page — so a closed-page sweep says
  // nothing about whether the form the user actually fills in fits the screen.
  const MODALS: [string, RegExp][] = [
    ['/admin/users', /add user/i],
    ['/admin/parameters', /add parameter/i],
    ['/admin/environments', /add environment/i],
  ]

  for (const [path, buttonName] of MODALS) {
    test(`${path} dialog (${buttonName.source}) fits a phone`, async ({ page }) => {
      await page.setViewportSize({ width: WIDTHS[0], height: 800 })
      await page.goto(path)
      await page.getByRole('button', { name: buttonName }).first().click()
      const dialog = page.locator('dialog[open]')
      await expect(dialog).toBeVisible()
      // The entrance animation scales the box, and getBoundingClientRect reports
      // the transformed rect — measuring mid-flight reads a dialog 5% narrower
      // than the one the user sees.
      await dialog.evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)))

      const box = await dialog.evaluate((d) => {
        const r = d.getBoundingClientRect()
        return { left: r.left, right: r.right, vw: document.documentElement.clientWidth }
      })
      expect(
        box.left,
        `${path} dialog starts at x=${box.left} on a ${box.vw}px screen — its left edge is off-screen`,
      ).toBeGreaterThanOrEqual(-1)
      expect(
        box.right,
        `${path} dialog ends at x=${box.right} on a ${box.vw}px screen — it runs off the right edge`,
      ).toBeLessThanOrEqual(box.vw + 1)
    })
  }
})

test.describe('Reflow (WCAG 1.4.10) — the controls the shell hides', () => {
  // 1.4.10 is about "loss of functionality", not only about a scrollbar: the
  // header used to render its right-hand cluster past x=375 with no way to scroll
  // to it, which put **Sign out** and the cart outside the screen entirely. A
  // document that no longer overflows would satisfy the assertions above while
  // still having pushed those controls behind a `hidden` — so name them.
  const REACHABLE = [
    ['the cart', 'a[href="/cart"]'],
    ['the language switcher', 'button[aria-label^="Language"]'],
  ] as const

  test('the cart and the language switcher are reachable on a phone', async ({ page }) => {
    await page.setViewportSize({ width: WIDTHS[0], height: 800 })
    await page.goto('/')
    await authedReady(page)

    for (const [name, selector] of REACHABLE) {
      const el = page.locator(`header ${selector}`).first()
      await expect(el, `${name} should exist in the header`).toBeVisible()
      const box = await el.evaluate((n) => {
        const r = n.getBoundingClientRect()
        return { left: r.left, right: r.right, vw: document.documentElement.clientWidth }
      })
      expect(box.right, `${name} ends at x=${box.right} on a ${box.vw}px screen`).toBeLessThanOrEqual(box.vw + 1)
      expect(box.left, `${name} starts at x=${box.left}`).toBeGreaterThanOrEqual(-1)
    }
  })

  test('sign out is reachable on a phone', async ({ page }) => {
    // The account panel is anchored `right-0` to a control that was itself
    // off-screen, so the panel holding Sign out measured left:413 on a 375px
    // viewport — every pixel of it outside the window.
    await page.setViewportSize({ width: WIDTHS[0], height: 800 })
    await page.goto('/')
    await authedReady(page)

    await page.locator('header summary').first().click()
    const signOut = page.locator('header details[open] button').filter({ hasText: /sign out/i }).first()
    await expect(signOut).toBeVisible()

    const box = await signOut.evaluate((n) => {
      const r = n.getBoundingClientRect()
      return { left: r.left, right: r.right, vw: document.documentElement.clientWidth }
    })
    expect(box.left, `sign out starts at x=${box.left} on a ${box.vw}px screen`).toBeGreaterThanOrEqual(-1)
    expect(box.right, `sign out ends at x=${box.right} on a ${box.vw}px screen`).toBeLessThanOrEqual(box.vw + 1)
  })
})
