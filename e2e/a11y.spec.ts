import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import type { Result } from 'axe-core'

/**
 * Accessibility gate.
 *
 * WCAG 2.1 A + AA across every page a user can reach, plus the AAA criteria this
 * app can actually honour, plus the dialog states — this app puts most of its
 * forms inside <dialog>, and a static scan never opens them, which is how six
 * admin modals went unchecked.
 *
 * Three things this suite deliberately does NOT rely on:
 *
 *  1. Default branding. The header, nav, hero and footer are painted on the
 *     operator's chosen colour. Hardcoded white text passed with the shipped
 *     dark default and collapsed to 1.88:1 on a mid-tone amber, so the contrast
 *     check runs against a deliberately hostile colour as well. See
 *     apps/frontend/src/lib/contrast.ts.
 *  2. axe alone. Focus visibility, target size and accessible-name language are
 *     not things axe can test at the level this app claims, so they get explicit
 *     assertions at the bottom.
 *  3. "AAA" as a slogan. Full AAA is not reachable for an app whose brand colour
 *     is chosen by the operator, so the AAA claim here is partial and the parts
 *     that were refused are written down — with the arithmetic — in
 *     docs/guides/accessibility.md. Read that before adding or removing a tag.
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
  '/admin/products/new',
  '/admin/parameters',
  '/admin/users',
  '/admin/cost-centers',
  '/admin/branding',
  '/admin/config/smtp',
  '/admin/config/ai',
  '/admin/exchange-rates',
]

/**
 * The tags requested from axe.
 *
 * The AAA tags earn exactly three rules — axe has no others — and all three ship
 * `enabled: false`. Naming a tag explicitly runs them anyway: axe's `matchTags`
 * only consults `rule.enabled` when the include list is empty. wcag21aaa and
 * wcag22aaa match nothing today; they are here so a future axe release that adds
 * an AAA rule is picked up rather than silently skipped.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag2aaa', 'wcag21aaa', 'wcag22aaa']

/**
 * The one AAA rule this app cannot satisfy, and why it is switched off rather
 * than tolerated.
 *
 * 1.4.6 wants 7:1. The chrome is painted on the OPERATOR's colour, and the only
 * two candidate inks are near-black and white — for a wide band of mid-tones
 * neither reaches 7:1 (#ca8a04 tops out at 6.05, #16a34a at 5.39). There is no
 * change the app can make: the background is the brand. Since the chrome is on
 * every page, leaving the rule on would mean a gate that is red forever, which is
 * a gate nobody reads. The half that IS reachable — the brand colour used as text
 * on our own surfaces — was raised to 7:1 in readableAccent instead, and
 * apps/frontend/src/lib/contrast.test.ts holds it there.
 *
 * Full reasoning, and the measured table: docs/guides/accessibility.md.
 */
const RULES_OUT_OF_SCOPE = ['color-contrast-enhanced']

/**
 * Rules whose "needs review" result is treated as a failure.
 *
 * `identical-links-same-purpose` (2.4.9) can never report a violation: when it
 * finds two links with the same name pointing at different URLs it sets the
 * result to undefined, which surfaces as `incomplete`. Asserting only on
 * `violations` would mean the rule was requested and then ignored — which is how
 * twenty "Details" links and one "Edit" per admin product row would have stayed.
 */
const REVIEW_IS_FAILURE = ['identical-links-same-purpose']

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

type Page = import('@playwright/test').Page

const scan = async (page: Page) =>
  await new AxeBuilder({ page }).withTags(WCAG).disableRules(RULES_OUT_OF_SCOPE).analyze()

/**
 * Wait until the page is actually the page, not its loading placeholders.
 *
 * `goto` resolves on `load`, which is BEFORE hydration has fired the fetch. A
 * client-rendered page — `/catalog`, `/admin/users`, `/admin/products` and most
 * of the rest — is still showing `SkeletonCard`/`SkeletonListItem` at that
 * moment, and a skeleton has no form controls, no headings and no text to fail
 * contrast on. So the gate reported clean and meant nothing (#155).
 *
 * Two halves, and the second is what makes it honest:
 *
 *   * no placeholder is left — `data-loading` is put there by the skeletons for
 *     exactly this purpose;
 *   * the page rendered SOMETHING. Without that a page which failed to load at
 *     all also has no placeholders, and would sail through as "clean" for the
 *     same reason the skeletons did.
 *
 * The second check is on the body's text and not on `main`, which was the first
 * attempt and was wrong: `/login` has no `main` landmark at all, and
 * `/impressum` renders without one when no imprint text is configured — which
 * is every CI database. Requiring one would have failed the gate for a layout
 * choice rather than for an accessibility defect. (A missing `main` is
 * `landmark-one-main`, a best-practice rule outside the WCAG A/AA tags this
 * gate requests, so axe does not ask for one either.)
 *
 * The spec already knew about this race: its detail-page block documents it
 * ("the catalogue fetches its products after hydration"). The 23 static pages
 * never got the wait.
 */
const settled = async (page: Page, where: string) => {
  await expect(page.locator('[data-loading]'), `${where} still showing loading placeholders`)
    .toHaveCount(0, { timeout: 15_000 })

  // Not a specific string — 25 pages have 25 different first paragraphs — but
  // some rendered text. A blank page is a page that did not load, and scanning
  // it proves nothing.
  await expect
    .poll(
      async () => (await page.locator('body').innerText()).trim().length,
      { message: `${where} rendered no text at all`, timeout: 15_000 },
    )
    .toBeGreaterThan(0)
}

/** Scan and judge, including the review-only rules. `where` names the page. */
const expectAccessible = async (page: Page, where: string) => {
  await settled(page, where)
  const { violations, incomplete } = await scan(page)
  expect(violations, `${where}\n${format(violations)}`).toEqual([])

  const review = incomplete.filter((r) => REVIEW_IS_FAILURE.includes(r.id))
  expect(review, `${where} — needs review, which this suite counts as failing\n${format(review)}`).toEqual([])
}

/** 44 CSS px: the WCAG 2.5.5 target size. */
const TARGET_MIN = 44

/**
 * Controls on the page smaller than `min` in either dimension.
 *
 * axe has no rule for 2.5.5 — its `target-size` rule is the WCAG 2.2 AA criterion
 * (2.5.8, 24px), which is a different and weaker claim — so this measures it.
 *
 * Scope is CONTROLS, not every clickable thing. Content links are excluded on
 * purpose: they sit inside lines of text a few pixels apart, and the exclusion is
 * argued in docs/guides/accessibility.md rather than hidden here. Checkboxes,
 * radios and file inputs are excluded for the reasons recorded there too — the
 * first two are a real gap, the third is 2.5.5's own user-agent exception.
 *
 * Zero-sized elements are skipped rather than failed: a control inside a closed
 * <details> or a hidden panel measures 0x0, and it is not a target while it
 * cannot be pointed at.
 */
const undersizedControls = (min: number) => {
  const SELECTOR = [
    'button',
    'summary',
    'select',
    'textarea',
    '[role="button"]',
    'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])',
  ].join(', ')

  return Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))
    .map((el) => {
      const r = el.getBoundingClientRect()
      return { el, w: r.width, h: r.height }
    })
    .filter(({ w, h }) => w > 0 && h > 0)
    // Sub-pixel layout: a 44px box can measure 43.99.
    .filter(({ w, h }) => w < min - 0.5 || h < min - 0.5)
    .map(({ el, w, h }) => {
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''
      return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `:${el.getAttribute('type')}` : ''} ` +
        `"${name}" is ${w.toFixed(1)}x${h.toFixed(1)} — class="${el.className}"`
    })
}

test.describe('Accessibility — public pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of PUBLIC_PAGES) {
    test(`${path} is clean at A, AA and the AAA criteria in scope`, async ({ page }) => {
      await page.goto(path)
      await expectAccessible(page, path)
    })
  }
})

test.describe('Accessibility — authenticated pages', () => {
  for (const path of AUTHED_PAGES) {
    test(`${path} is clean at A, AA and the AAA criteria in scope`, async ({ page }) => {
      await page.goto(path)
      await expectAccessible(page, path)
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
    // Root's view of another user's sessions (#37). It is a dialog, so a static
    // scan of /admin/users never opens it — the same reason the six above are
    // listed. The name matched is the button's aria-label, which carries the
    // user it belongs to.
    // Matches the `activeSessions` key ('Active sessions'), not a literal — the
    // button's accessible name is translated, so anchoring on English prose that
    // is no longer there is how this silently stops opening the dialog.
    ['/admin/users', /^Active sessions:/],
  ]

  for (const [path, buttonName] of MODALS) {
    test(`${path} dialog (${buttonName.source}) is clean at A, AA and the AAA criteria in scope`, async ({ page }) => {
      await page.goto(path)
      await page.getByRole('button', { name: buttonName }).first().click()
      await expect(page.locator('dialog[open]')).toBeVisible()

      await expectAccessible(page, `${path} dialog`)

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

  /*
   * What the colour was before this file touched it.
   *
   * Captured once and restored in `afterAll` as well as in the test's own
   * `finally`, because the two fail in different ways. A `finally` covers an
   * assertion that throws; it does NOT cover a test that times out, a run
   * stopped by `--max-failures`, or a worker that is torn down — and the amber
   * left behind by any of those persists in the database. That amber primary is
   * known to fail axe on `/`, so with `retries: 1` the retry then scans a
   * poisoned database and fails for the wrong reason, on a page this test never
   * touched (#155).
   *
   * Belt and braces on purpose: neither hook survives a SIGKILL, and a shared
   * mutable colour is what this test is. The pair closes every failure mode
   * short of that.
   */
  let originalColour: string | null = null

  const HEX_FIELD = /primary color — hex value/i

  const writeColour = async (page: Page, value: string) => {
    await page.goto('/admin/branding')
    await page.getByRole('textbox', { name: HEX_FIELD }).fill(value)
    await page.getByRole('button', { name: /save branding/i }).click()
  }

  test.afterAll(async ({ browser }) => {
    if (originalColour === null) return

    /*
     * Its own context: the test's page is gone by now, and a torn-down one is
     * exactly the case this hook exists for.
     *
     * `browser.newContext()` inherits NOTHING from the project — not the
     * baseURL, so `/admin/branding` is not a URL it can navigate to, and not the
     * storageState, so it would arrive signed out and be bounced to /login.
     * A restore hook that cannot restore is worse than none: it reads as though
     * the colour was put back.
     *
     * Taken from `test.info().project.use` rather than repeated as literals,
     * because a second copy of the baseURL is a second thing to keep in step.
     */
    const { baseURL, storageState } = test.info().project.use
    const context = await browser.newContext({ baseURL, storageState })
    const page = await context.newPage()
    try {
      await writeColour(page, originalColour)
      await page.reload()
      await expect(page.getByRole('textbox', { name: HEX_FIELD })).toHaveValue(originalColour)
    } finally {
      await context.close()
    }
  })

  test('a mid-tone primary colour keeps the dashboard AA-clean', async ({ page }) => {
    // This test mutates shared server state, so it reads the current value from
    // the FORM (not an API call that might fail) and restores it both in the
    // finally below and in the afterAll above. Serial mode keeps a parallel
    // worker from seeing the hostile colour mid-flight.
    test.slow()
    await page.goto('/admin/branding')
    const hex = page.getByRole('textbox', { name: HEX_FIELD })
    const original = await hex.inputValue()
    expect(original, 'could not read the current branding colour to restore later').toMatch(/^#[0-9a-fA-F]{3,6}$/)
    // Recorded BEFORE the write, so the hook can undo it even if everything
    // below this line is skipped.
    originalColour = original

    const save = () => page.getByRole('button', { name: /save branding/i }).click()

    try {
      await hex.fill(HOSTILE)
      await save()

      for (const path of ['/', '/catalog', '/admin']) {
        await page.goto(path)
        // The same wait every other scan takes: with the hostile colour applied,
        // a skeleton has nothing coloured to fail on, so scanning one would
        // report clean and prove nothing.
        await settled(page, `${path} with primary ${HOSTILE}`)
        const { violations } = await scan(page)
        const contrast = violations.filter((v) => v.id === 'color-contrast')
        expect(contrast, `${path} with primary ${HOSTILE}:\n${format(contrast)}`).toEqual([])
      }
    } finally {
      await writeColour(page, original)
      // Prove the restore landed rather than assuming it did.
      await page.reload()
      await expect(page.getByRole('textbox', { name: HEX_FIELD })).toHaveValue(original)
      // The afterAll hook has nothing left to undo.
      originalColour = null
    }
  })

  test('the branding form warns before an unreadable colour is saved', async ({ page }) => {
    await page.goto('/admin/branding')
    // A mid grey is the one case where neither ink reaches AA, so the operator
    // has to be told rather than silently shipping an unreadable header.
    await page.getByRole('textbox', { name: /primary color — hex value/i }).fill('#7b7b7b')
    // Matches the `contrastFailsAA` string, not the sentence this warning used to
    // be: translating the admin area replaced the hard-coded "WCAG AA needs N:1"
    // with keys, so the old regex matched nothing and this test failed for a
    // wording change rather than a behaviour one.
    await expect(
      page.getByRole('alert').filter({ hasText: /does not meet WCAG AA/i }),
    ).toBeVisible()
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
  // t('breadcrumb', 'en'). The saved session carries no lang cookie, so these
  // pages render in English.
  // Located structurally, NOT by the English label. `getLang()` falls back to the
  // Accept-Language header when no cookie is set, so a runner negotiating any
  // other locale would translate the aria-label out from under a hard-coded
  // selector — and the test would fail for a language setting rather than for an
  // accessibility problem. Any labelled nav inside main is the trail; there is
  // only one.

  const DETAIL_PAGES = [
    { from: '/infrastructure', link: 'a[href^="/infrastructure/"]', name: 'an infrastructure element' },
    { from: '/orders', link: 'a[href^="/orders/"]', name: 'an order' },
    { from: '/catalog', link: 'a[href^="/catalog/"]', name: 'a product' },
    { from: '/projects', link: 'a[href^="/projects/"]', name: 'a project' },
    // The one detail page this list was missing, and the one with the most form
    // controls on it (issue #102).
    // Excluding /new, which is the first such link on the page and is covered as
    // a static route in AUTHED_PAGES.
    {
      from: '/admin/products',
      link: 'a[href^="/admin/products/"]:not([href$="/new"])',
      name: 'a product in the admin area',
    },
  ]

  for (const { from, link, name } of DETAIL_PAGES) {
    test(`${name} is clean, and says where it is`, async ({ page }) => {
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

      /*
       * Navigated by URL, not by clicking.
       *
       * These are Next.js `<Link>`s: the click only navigates once React has
       * hydrated, and Playwright's actionability checks are satisfied by the
       * server-rendered anchor long before that. So the click landed on an inert
       * element, nothing happened, and `toHaveURL` timed out — a hydration race,
       * reported as an accessibility failure.
       *
       * Reading the href and going there keeps what this test is for: it still
       * proves the list links point at a real detail page, and it is the detail
       * page's accessibility that is being scanned. Whether a Link hydrates is a
       * different test's job.
       */
      const href = await first.getAttribute('href')
      expect(href, `${from} has a ${link} with no href`).toBeTruthy()
      await page.goto(href!)
      await expect(page).toHaveURL(new RegExp(`${from}/`), { timeout: 30000 })
      // Wait for the page's own content, not just the URL: scanning a shell that
      // is still streaming in would pass for the wrong reason.
      await expect(page.locator('main h1')).toBeVisible({ timeout: 30000 })

      await expectAccessible(page, `${from} → detail`)

      // 2.4.8 Location. Every one of these pages is reached FROM a list, and only
      // the product page used to say so — with an ad-hoc <nav> named "Catalog",
      // which reads as a second navigation landmark rather than a location. The
      // last crumb is the assertion that matters: a trail whose final item is not
      // marked as the current page states a path, not a position.
      const trail = page.locator('main nav[aria-label] ol')
      await expect(trail, 'expected a breadcrumb trail (WCAG 2.4.8)').toBeVisible()
      await expect(trail.locator('li')).not.toHaveCount(0)
      await expect(trail.locator('[aria-current="page"]')).toHaveCount(1)
    })
  }
})

/**
 * WCAG 2.5.5 Target Size (AAA) — 44x44 CSS px.
 *
 * Its own block because axe cannot do it. axe ships `target-size`, but that rule
 * is WCAG 2.2 AA (2.5.8) at 24px: passing it says nothing about 2.5.5. So this
 * measures the rendered boxes, which also means it catches a control that a
 * caller's `className` shrank after the primitive was fixed.
 *
 * Before this, `size="sm"` buttons were 28px, `md` 36px, text inputs 38px, the
 * modal close 28px and the toast dismiss 16px. The floor now lives in the
 * primitives (`Button`, `Input`, `Select`) so a new call site inherits it.
 *
 * What is NOT measured, and why, is in docs/guides/accessibility.md: content
 * links, native checkboxes and native file inputs.
 */
test.describe('Accessibility — target size (2.5.5)', () => {
  // A spread rather than every route: these six between them render the whole
  // control vocabulary — the chrome, the catalogue's own filter buttons, a table
  // with row actions, a dense admin form, and the colour pickers.
  const PAGES = ['/', '/catalog', '/orders', '/infrastructure', '/admin/products', '/admin/branding']

  for (const path of PAGES) {
    test(`every control on ${path} is at least 44x44`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('main h1, main h2').first()).toBeVisible({ timeout: 30000 })

      const undersized = await page.evaluate(undersizedControls, TARGET_MIN)
      expect(undersized, `${path}:\n  ${undersized.join('\n  ')}`).toEqual([])
    })
  }

  test('the controls inside a dialog are targets too', async ({ page }) => {
    // Most of this app's form controls only exist while a modal is open, so a
    // closed-page sweep would miss the majority of them — the same blind spot the
    // dialog scans above exist for.
    await page.goto('/admin/categories')
    await page.getByRole('button', { name: /add category/i }).first().click()
    await expect(page.locator('dialog[open]')).toBeVisible()

    // Wait for the entrance animation to land before measuring. `modal-in` runs
    // scale(0.95) → scale(1) over 200ms (globals.css), and getBoundingClientRect
    // reports the TRANSFORMED box — so a 44px control inside the dialog measures
    // 42.7 while the animation is still in flight, and this test failed on the
    // close button, both inputs, Cancel and Save for a reason that has nothing to
    // do with their size. Awaiting the animations rather than sleeping a guessed
    // number of milliseconds: the wait then cannot be too short on a loaded runner.
    await page
      .locator('dialog[open]')
      .evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)))

    const undersized = await page.evaluate(undersizedControls, TARGET_MIN)
    expect(undersized, `add-category dialog:\n  ${undersized.join('\n  ')}`).toEqual([])
  })
})

/**
 * The AAA criteria that are asserted rather than excluded, and that no rule covers.
 *
 * Each of these is one clause of a criterion this app does NOT claim in full — see
 * docs/guides/accessibility.md for what the rest of 1.4.8 would need. Asserting
 * the reachable clause is still worth it: it is the part that regresses silently.
 */
test.describe('Accessibility — AAA clauses with no axe rule', () => {
  test('no block of text is justified (1.4.8)', async ({ page }) => {
    // Justified text opens rivers of white space down a paragraph, which is the
    // one part of 1.4.8 that is both free and easy to reintroduce with a stray
    // `text-justify`.
    await page.goto('/catalog')
    const justified = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('main p, main li, main dd, main td'))
        .filter((el) => getComputedStyle(el).textAlign === 'justify')
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    )
    expect(justified, `justified text found:\n  ${justified.join('\n  ')}`).toEqual([])
  })

  test('the breadcrumb trail is a list, and only its last item is the current page (2.4.8)', async ({ page }) => {
    // /admin/products/new is the deepest static route, so it is the one that
    // proves a multi-level trail rather than a two-item one — and unlike the
    // detail pages it needs no seed data, so this clause is checked even in an
    // empty environment.
    await page.goto('/admin/products/new')
    // Structural, not the English label — see the note on the other trail locator.
    const trail = page.locator('main nav[aria-label] ol')
    await expect(trail).toBeVisible()
    await expect(trail.locator('> li')).toHaveCount(3)
    await expect(trail.locator('[aria-current="page"]')).toHaveCount(1)
    // The current page is not a link: there is nowhere to go.
    await expect(trail.locator('a[aria-current="page"]')).toHaveCount(0)
    // And the separators are not read out as words.
    await expect(trail.locator('span[aria-hidden="true"]')).toHaveCount(2)
  })
})
