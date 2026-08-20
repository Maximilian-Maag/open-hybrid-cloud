import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Result } from 'axe-core'

/**
 * Accessibility gate.
 *
 * WCAG 2.1 A + AA across every page a user can reach, plus the dialog states —
 * this app puts most of its forms inside <dialog>, and a static scan never opens
 * them, which is how six admin modals went unchecked.
 *
 * Two things this suite deliberately does NOT rely on:
 *
 *  1. Default branding. The header, nav, hero and footer are painted on the
 *     operator's chosen colour. Hardcoded white text passed with the shipped
 *     dark default and collapsed to 1.88:1 on a mid-tone amber, so the contrast
 *     check runs against a deliberately hostile colour as well. See
 *     apps/frontend/src/lib/contrast.ts.
 *  2. axe alone. Focus visibility and accessible-name language are not things
 *     axe can test, so they get explicit assertions at the bottom.
 */

const PUBLIC_PAGES = ['/login', '/impressum']

const AUTHED_PAGES = [
  '/',
  '/catalog',
  '/cart',
  '/orders',
  '/projects',
  '/infrastructure',
  '/costs',
  '/approvals',
  '/audit',
  '/settings',
  '/admin',
  '/admin/categories',
  '/admin/ci-sources',
  '/admin/environments',
  '/admin/products',
  '/admin/parameters',
  '/admin/users',
  '/admin/cost-centers',
  '/admin/branding',
  '/admin/config/smtp',
  '/admin/config/ai',
  '/admin/exchange-rates',
]

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Compact, greppable failure output — the default axe dump is unreadable in CI. */
const format = (violations: Result[]): string =>
  violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => `      ${n.target.join(' ')}\n        ${n.failureSummary?.replace(/\s+/g, ' ').slice(0, 160)}`)
        .join('\n')
      const more = v.nodes.length > 5 ? `\n      … and ${v.nodes.length - 5} more node(s)` : ''
      return `  [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))\n${nodes}${more}\n    ${v.helpUrl}`
    })
    .join('\n\n')

/**
 * Is a focus indicator actually painted on this element?
 *
 * Tailwind renders its focus ring as a box-shadow AND always emits the ring
 * custom properties, so `boxShadow !== 'none'` is not enough — an unset ring
 * colour produces a shadow made entirely of fully transparent layers. A layer
 * counts only if its colour is not transparent.
 *
 * Deliberately not a regex: the obvious one (a repeated group containing
 * `[^,]*`) backtracks exponentially on a long all-transparent shadow, which
 * CodeQL flags as a ReDoS.
 */
const focusProbe = () => {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  const c = getComputedStyle(el)
  const outlined = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0

  const paints = (shadow: string): boolean => {
    if (!shadow || shadow === 'none') return false
    // Split on the colour function each layer starts with, then keep any layer
    // whose colour is not fully transparent.
    return shadow
      .split(/(?=rgba?\(|oklch\(|color\()/)
      .map((s) => s.trim())
      .filter(Boolean)
      .some((layer) => {
        const alpha = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)/.exec(layer)
        if (alpha) return parseFloat(alpha[1]) > 0
        // oklch()/color() layers here carry no alpha, so they paint.
        return true
      })
  }

  return {
    outlined,
    ringed: paints(c.boxShadow),
    inDialog: !!el.closest('dialog'),
    id:
      el.tagName.toLowerCase() +
      (el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : '') +
      (el.getAttribute('type') ? `:${el.getAttribute('type')}` : ''),
  }
}

const scan = async (page: import('@playwright/test').Page) =>
  await new AxeBuilder({ page }).withTags(WCAG).analyze()

test.describe('Accessibility — public pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of PUBLIC_PAGES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path)
      const { violations } = await scan(page)
      expect(violations, `\n${format(violations)}`).toEqual([])
    })
  }
})

test.describe('Accessibility — authenticated pages', () => {
  for (const path of AUTHED_PAGES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path)
      const { violations } = await scan(page)
      expect(violations, `\n${format(violations)}`).toEqual([])
    })
  }
})

test.describe('Accessibility — dialogs', () => {
  // Most forms in this app live inside a modal, so scanning only the closed page
  // leaves the majority of the form controls unchecked.
  const MODALS: [string, RegExp][] = [
    ['/admin/categories', /add category/i],
    ['/admin/ci-sources', /add ci source/i],
    ['/admin/environments', /add environment/i],
    ['/admin/cost-centers', /add cost center/i],
    ['/admin/parameters', /add parameter/i],
    ['/admin/users', /add user/i],
  ]

  for (const [path, buttonName] of MODALS) {
    test(`${path} dialog has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path)
      await page.getByRole('button', { name: buttonName }).first().click()
      await expect(page.locator('dialog[open]')).toBeVisible()

      const { violations } = await scan(page)
      expect(violations, `\n${format(violations)}`).toEqual([])

      // A modal that traps focus and closes on Escape is the reason the native
      // <dialog> element was chosen; assert it so a hand-rolled overlay can't
      // quietly replace it.
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('dialog')),
        'focus should start inside the dialog',
      ).toBe(true)

      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
    })
  }
})

test.describe('Accessibility — branding colours cannot break the chrome', () => {
  // Writes shared server state, so no parallel worker may observe it half-applied.
  test.describe.configure({ mode: 'serial' })

  // The regression this guards: the portal chrome used to hardcode white text on
  // the operator's primary colour. A mid-tone choice dropped the nav to 1.88:1.
  // Foregrounds are now derived from the colour's luminance, so a hostile colour
  // has to stay AA-clean.
  const HOSTILE = '#ca8a04' // amber-600 — the value that produced 246 failures

  test('a mid-tone primary colour keeps the dashboard AA-clean', async ({ page }) => {
    // This test mutates shared server state, so it reads the current value from
    // the FORM (not an API call that might fail) and restores it in an
    // afterEach-style finally. Serial mode keeps a parallel worker from seeing
    // the hostile colour mid-flight.
    test.slow()
    await page.goto('/admin/branding')
    const hex = page.getByRole('textbox', { name: /primary color — hex value/i })
    const original = await hex.inputValue()
    expect(original, 'could not read the current branding colour to restore later').toMatch(/^#[0-9a-fA-F]{3,6}$/)

    const save = () => page.getByRole('button', { name: /save branding/i }).click()

    try {
      await hex.fill(HOSTILE)
      await save()

      for (const path of ['/', '/catalog', '/admin']) {
        await page.goto(path)
        const { violations } = await scan(page)
        const contrast = violations.filter((v) => v.id === 'color-contrast')
        expect(contrast, `${path} with primary ${HOSTILE}:\n${format(contrast)}`).toEqual([])
      }
    } finally {
      await page.goto('/admin/branding')
      await page.getByRole('textbox', { name: /primary color — hex value/i }).fill(original)
      await save()
      // Prove the restore landed rather than assuming it did.
      await page.reload()
      await expect(page.getByRole('textbox', { name: /primary color — hex value/i })).toHaveValue(original)
    }
  })

  test('the branding form warns before an unreadable colour is saved', async ({ page }) => {
    await page.goto('/admin/branding')
    // A mid grey is the one case where neither ink reaches AA, so the operator
    // has to be told rather than silently shipping an unreadable header.
    await page.getByRole('textbox', { name: /primary color — hex value/i }).fill('#7b7b7b')
    await expect(page.getByRole('alert').filter({ hasText: /WCAG AA needs/i })).toBeVisible()
  })
})

test.describe('Accessibility — things axe cannot check', () => {
  test('every interactive control in the chrome shows a visible focus indicator', async ({ page }) => {
    await page.goto('/admin/categories')

    const controls: [string, string][] = [
      ['header account menu', 'header summary'],
      ['header search input', 'header input[type="text"]'],
      ['header search button', 'header button[type="submit"]'],
      ['nav link', 'nav a'],
      ['skip link', 'a[href="#main"]'],
    ]

    for (const [label, selector] of controls) {
      const el = page.locator(selector).first()
      await el.focus()
      // Some of these carry `transition-all`, so let the ring finish fading in
      // before reading the computed style.
      await page.waitForTimeout(250)
      const probe = await page.evaluate(focusProbe)
      const visible = !!probe && (probe.outlined || probe.ringed)
      expect(visible, `${label} (${selector}) must show a focus indicator`).toBe(true)
    }
  })

  test('every focus stop inside a dialog shows a focus indicator', async ({ page }) => {
    await page.goto('/admin/categories')
    await page.getByRole('button', { name: /add category/i }).first().click()
    await expect(page.locator('dialog[open]')).toBeVisible()

    // Tab with the real keyboard rather than calling .focus(): Chromium only
    // matches :focus-visible on a <button> after keyboard interaction, so
    // programmatic focus would report a false failure for any ring bound to it.
    // A fixed number of Tab presses rather than de-duplicating stops: two
    // unlabelled inputs are indistinguishable from the outside, and checking the
    // same control twice costs nothing.
    let stops = 0
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      // Button carries `transition-all`, so its ring fades in over ~150ms. Reading
      // the computed box-shadow immediately catches the transparent start of that
      // transition and reports a false failure.
      await page.waitForTimeout(250)
      const probe = await page.evaluate(focusProbe)
      // Tabbing can leave the dialog (browser chrome); only judge stops inside it.
      const stop = probe?.inDialog ? probe : null
      if (!stop) continue
      stops++
      expect(
        stop.outlined || stop.ringed,
        `${stop.id} inside the dialog must show a focus indicator`,
      ).toBe(true)
    }

    // Guard against the loop silently finding nothing to check.
    expect(stops, 'expected focusable controls inside the dialog').toBeGreaterThan(2)
  })

  test('accessible names follow the document language', async ({ page }) => {
    await page.goto('/admin/categories')
    // Switch the UI to German, then check that the names assistive tech reads
    // are German too — they used to be hardcoded English inside a lang="de"
    // document, which is what WCAG 3.1.2 is about.
    await page.context().addCookies([
      { name: 'lang', value: 'de', url: page.url() },
    ])
    await page.reload()

    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('a[href="#main"]')).toHaveText(/Zum Inhalt springen/i)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Kategorien/i)

    await page.getByRole('button', { name: /kategorie hinzufügen|add category/i }).first().click()
    await expect(page.locator('dialog[open]')).toBeVisible()
    await expect(page.locator('dialog[open] button[aria-label]').first()).toHaveAttribute(
      'aria-label',
      'Schließen',
    )
  })

  test('the current page is exposed to assistive tech, not signalled by colour alone', async ({ page }) => {
    await page.goto('/catalog')
    const current = page.locator('nav a[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveAttribute('href', '/catalog')
  })

  test('reduced-motion is honoured', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/orders')

    // Assert the element EXISTS before judging it: the previous version swallowed
    // a missing locator into a default of '0s' and passed while checking nothing.
    const animated = page.locator('main [class*="animate-"]').first()
    await expect(animated, 'expected an animated element to test against').toHaveCount(1)

    const duration = await animated.evaluate((n) => getComputedStyle(n).animationDuration)
    expect(parseFloat(duration), `animation-duration was ${duration}`).toBeLessThan(0.05)

    // And confirm the same element really does animate without the preference,
    // so this cannot pass just because nothing was animated in the first place.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/orders')
    const normal = await page
      .locator('main [class*="animate-"]')
      .first()
      .evaluate((n) => getComputedStyle(n).animationDuration)
    expect(parseFloat(normal), `expected a real animation without the preference, got ${normal}`).toBeGreaterThan(0.05)
  })
})

/**
 * Detail pages, which AUTHED_PAGES cannot cover because their URLs contain an id.
 *
 * This gap is why an anchor wrapping a button reached the infrastructure detail
 * page unnoticed: every list page was scanned, and none of the pages you reach
 * FROM them was. Each test walks in from the list and skips when the database has
 * nothing to walk to, so an empty environment reports "skipped" rather than a pass
 * over a page that never rendered.
 */
test.describe('Accessibility — detail pages', () => {
  const DETAIL_PAGES = [
    { from: '/infrastructure', link: 'a[href^="/infrastructure/"]', name: 'an infrastructure element' },
    { from: '/orders', link: 'a[href^="/orders/"]', name: 'an order' },
    { from: '/catalog', link: 'a[href^="/catalog/"]', name: 'a product' },
    { from: '/projects', link: 'a[href^="/projects/"]', name: 'a project' },
  ]

  for (const { from, link, name } of DETAIL_PAGES) {
    test(`${name} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(from)
      const first = page.locator(`main ${link}`).first()
      // Wait before concluding there is nothing to open: the catalogue fetches its
      // products after hydration, so counting immediately after goto() skipped a
      // page that was about to render.
      await first.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
      if (await first.count() === 0) {
        test.skip(true, `nothing on ${from} to open — seed the demo data (make db-seed-demo)`)
        return
      }

      await first.click()
      await expect(page).toHaveURL(new RegExp(`${from}/`), { timeout: 30000 })
      // Wait for the page's own content, not just the URL: scanning a shell that
      // is still streaming in would pass for the wrong reason.
      await expect(page.locator('main h1')).toBeVisible({ timeout: 30000 })

      const { violations } = await scan(page)
      expect(violations, `\n${format(violations)}`).toEqual([])
    })
  }
})
