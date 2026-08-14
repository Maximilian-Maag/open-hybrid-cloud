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
  '/orders',
  '/projects',
  '/infrastructure',
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
  // The regression this guards: the portal chrome used to hardcode white text on
  // the operator's primary colour. A mid-tone choice dropped the nav to 1.88:1.
  // Foregrounds are now derived from the colour's luminance, so a hostile colour
  // has to stay AA-clean.
  const HOSTILE = '#ca8a04' // amber-600 — the value that produced 246 failures

  test('a mid-tone primary colour keeps the dashboard AA-clean', async ({ page, request }) => {
    const original = await (await request.get('/api/admin/branding')).json().catch(() => null)

    await page.goto('/admin/branding')
    const hex = page.getByRole('textbox', { name: /primary color — hex value/i })
    await hex.fill(HOSTILE)
    await page.getByRole('button', { name: /save branding/i }).click()

    try {
      for (const path of ['/', '/catalog', '/admin']) {
        await page.goto(path)
        const { violations } = await scan(page)
        const contrast = violations.filter((v) => v.id === 'color-contrast')
        expect(contrast, `${path} with primary ${HOSTILE}:\n${format(contrast)}`).toEqual([])
      }
    } finally {
      // Leave branding as it was, so this test does not colour every later one.
      if (original?.primaryColor) {
        await page.goto('/admin/branding')
        await page.getByRole('textbox', { name: /primary color — hex value/i }).fill(original.primaryColor)
        await page.getByRole('button', { name: /save branding/i }).click()
      }
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
      const visible = await el.evaluate((n) => {
        const c = getComputedStyle(n)
        const outlined = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0
        // Tailwind renders its focus ring as a box-shadow, and the ring vars
        // default to transparent — so a shadow only counts if it actually paints.
        const ringed = c.boxShadow !== 'none' && !/^(rgba\(0, 0, 0, 0\)[^,]*,?\s*)+$/.test(c.boxShadow)
        return outlined || ringed
      })
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
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || !el.closest('dialog')) return null
        const c = getComputedStyle(el)
        const outlined = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0
        // Tailwind paints its ring as a box-shadow, and the ring vars default to
        // transparent — a shadow only counts when it actually renders a colour.
        const ringed =
          c.boxShadow !== 'none' && !/^(rgba\(0, 0, 0, 0\)[^,]*,?\s*)+$/.test(c.boxShadow)
        return {
          id: `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}${el.getAttribute('type') ? `:${el.getAttribute('type')}` : ''}`,
          visible: outlined || ringed,
        }
      })
      if (!stop) continue
      stops++
      expect(stop.visible, `${stop.id} inside the dialog must show a focus indicator`).toBe(true)
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
    // The page-in animation is decorative; under reduce it must not run for a
    // perceptible duration.
    const duration = await page
      .locator('main .animate-page-in, main [class*="animate-"]')
      .first()
      .evaluate((n) => getComputedStyle(n).animationDuration)
      .catch(() => '0s')
    expect(parseFloat(duration)).toBeLessThan(0.05)
  })
})
