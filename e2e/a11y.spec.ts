import { test, expect } from '@playwright/test'
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
 *  2. axe alone. Focus visibility, target size, accessible-name language,
 *     selection state and glyph-only contrast are not things axe can test at the
 *     level this app claims, so they get explicit assertions at the bottom.
 *     Glyph-only contrast is not a gap axe could close: `color-contrast` matches
 *     on `hasRealTextChildren`, which strips punctuation before deciding there is
 *     text — so `*`, `·`, `→`, `—` and anything else that is one non-alphanumeric
 *     character are excluded from the rule by construction, at every viewport and
 *     under every configuration. The required-field asterisk sat at 3.81:1 for as
 *     long as this suite has existed and neither layer could ever have said so.
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
 *
 * `best-practice` is here because the WCAG tags alone leave a third of the rule
 * set unasked-for. Measured against axe-core 4.13.0: 30 of its 105 rules carry
 * `best-practice` and no `wcagN` tag, so none of them ran. Three of those 30 are
 * still skipped after this — axe's default `tagExclude` is
 * `['experimental', 'deprecated']`, which drops `focus-order-semantics`,
 * `hidden-content` and `landmark-complementary-is-top-level` — leaving 27 rules
 * that this suite now evaluates and did not before.
 *
 * Two of them are the reason it is worth it: `page-has-heading-one` and
 * `heading-order` would each have caught, on the first run, that `/` and
 * `/catalog` had no `<h1>` at all, and that every `PageHeader` page went
 * h1 → h3 because `Card` hardcoded `<h3>`. Both are structural facts about the
 * page that WCAG maps to a judgement (1.3.1, 2.4.6) rather than to a testable
 * rule, which is exactly why they are tagged best-practice and not wcagN.
 */
const WCAG = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag2aaa',
  'wcag21aaa',
  'wcag22aaa',
  'best-practice',
]

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
 * Is a focus indicator painted on this element, and can it be SEEN?
 *
 * The first half is easy and was all this used to do: Tailwind draws its focus
 * ring as a box-shadow and always emits the ring custom properties, so
 * `boxShadow !== 'none'` proves nothing.
 *
 * The second half is the part that mattered. The previous version counted any
 * non-transparent shadow layer as a pass, which is a test for "a ring was
 * painted", not "a ring is visible" — and those come apart exactly where it
 * hurts. `ring-2` with no ring-<colour> leaves `--tw-ring-color` at its
 * Tailwind 4.3.1 fallback of `currentcolor`; on the sign-in button currentColor
 * is `--bp-ink`, which is #ffffff on the shipped default primary, painted over
 * a #fff offset on a white card. Fully opaque, completely invisible, and the
 * old probe passed it. So each layer's colour is now measured against the
 * background it sits on, and 1.4.11's 3:1 is the bar.
 *
 * Colours are resolved by PAINTING them: Chromium serialises modern colours
 * (oklch, color()) back out in their own syntax, and Tailwind 4's palette is
 * oklch, so a regex over the computed string would have to reimplement colour
 * conversion. A 1x1 canvas gives the sRGB bytes the user actually sees.
 *
 * Deliberately not a regex for the layer split: the obvious one (a repeated
 * group containing `[^,]*`) backtracks exponentially on a long all-transparent
 * shadow, which CodeQL flags as a ReDoS.
 */
const focusProbe = () => {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  const c = getComputedStyle(el)
  const outlined = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0

  const ctx = document.createElement('canvas').getContext('2d')
  /** Any CSS colour → [r, g, b, a] as painted, or null if the browser rejects it. */
  const paint = (colour: string): [number, number, number, number] | null => {
    if (!ctx) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = colour
    if (ctx.fillStyle === '#000000' && !/^(#0{3,8}|black|rgba?\(0, ?0, ?0)/i.test(colour.trim())) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }

  const luminance = ([r, g, b]: [number, number, number, number]): number => {
    const [rr, gg, bb] = [r, g, b].map((v) => {
      const sv = v / 255
      return sv <= 0.03928 ? sv / 12.92 : Math.pow((sv + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
  }

  const ratio = (a: [number, number, number, number], b: [number, number, number, number]): number => {
    const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]
    return (hi + 0.05) / (lo + 0.05)
  }

  /**
   * What the ring is painted ON.
   *
   * Started at the PARENT, not at the element: a focus ring is drawn outside the
   * border box, so the element's own fill is not behind it. Measuring against
   * the element itself reported the sign-in button's ring at 2.94:1 — against
   * its own navy background, which the ring never touches — while the surface it
   * actually sits on is the white card.
   *
   * The offset counts as a ground too where there is one: `ring-offset-2` puts a
   * 2px band of `--tw-ring-offset-color` between the control and the ring, so
   * that band is the ring's inner neighbour. The strictest of the two grounds
   * wins.
   */
  const grounds = (): [number, number, number, number][] => {
    const found: [number, number, number, number][] = []
    for (let node = el.parentElement; node; node = node.parentElement) {
      const painted = paint(getComputedStyle(node).backgroundColor)
      if (painted && painted[3] > 0.5) { found.push(painted); break }
    }
    if (parseFloat(c.getPropertyValue('--tw-ring-offset-width')) > 0) {
      const offset = paint(c.getPropertyValue('--tw-ring-offset-color').trim() || '#fff')
      if (offset && offset[3] > 0.5) found.push(offset)
    }
    return found.length ? found : [[255, 255, 255, 1]]
  }

  /** Best contrast any shadow layer reaches against every ground it touches. */
  const ringContrast = (shadow: string): number => {
    if (!shadow || shadow === 'none') return 0
    const against = grounds()
    return shadow
      .split(/(?=rgba?\(|oklch\(|color\(|hsla?\(|lab\(|lch\()/)
      .map((s) => s.trim())
      .filter(Boolean)
      .reduce((best, layer) => {
        const colour = /^[a-z]+\([^)]*\)/i.exec(layer)?.[0]
        const painted = colour ? paint(colour) : null
        // A transparent layer paints nothing, whatever its hue.
        if (!painted || painted[3] < 0.1) return best
        const worst = against.reduce((lowest, g) => Math.min(lowest, ratio(painted, g)), Infinity)
        return Math.max(best, worst)
      }, 0)
  }

  return {
    outlined,
    ringContrast: ringContrast(c.boxShadow),
    inDialog: !!el.closest('dialog'),
    id:
      el.tagName.toLowerCase() +
      (el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : '') +
      (el.getAttribute('type') ? `:${el.getAttribute('type')}` : ''),
  }
}

/** WCAG 1.4.11: a non-text indicator has to reach 3:1 against what it sits on. */
const RING_MIN_CONTRAST = 3

/** WCAG 1.4.3: body text needs 4.5:1. */
const AA_BODY = 4.5

/**
 * Glyph-only text below the contrast it owes — the class axe skips.
 *
 * Same painting trick as `focusProbe`, and for the same reason: Tailwind 4's
 * palette is oklch, so the computed colour string is oklch and a regex over it
 * would mean reimplementing colour conversion.
 *
 * "Glyph-only" is one visible character that is not a letter or a digit, in an
 * element with no element children — which is exactly the shape
 * `hasRealTextChildren` throws away, and exactly what a required-field asterisk
 * is. Deliberately narrow: widening it to all short text would re-report what
 * `color-contrast` already covers.
 *
 * Two bars, because these glyphs are two different things:
 *
 *  - Exposed to assistive tech (the required-field `*`): it is text, so 1.4.3
 *    asks for 4.5:1.
 *  - `aria-hidden` (the breadcrumb `›`): never announced, so it is not text for
 *    1.4.3 — but it is still the only thing doing its job visually, which is
 *    1.4.11 at 3:1. Holding a decorative separator to body-text contrast would
 *    be inventing a requirement; letting it off entirely left it at 2.51:1.
 */
const glyphOnlyContrast = ([textMin, decorationMin]: [number, number]) => {
  const ctx = document.createElement('canvas').getContext('2d')
  const paint = (colour: string): [number, number, number, number] | null => {
    if (!ctx) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = colour
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const luminance = ([r, g, b]: [number, number, number, number]): number => {
    const [rr, gg, bb] = [r, g, b].map((v) => {
      const sv = v / 255
      return sv <= 0.03928 ? sv / 12.92 : Math.pow((sv + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
  }
  const ratio = (a: [number, number, number, number], b: [number, number, number, number]): number => {
    const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]
    return (hi + 0.05) / (lo + 0.05)
  }
  const backdrop = (from: Element): [number, number, number, number] => {
    for (let node: Element | null = from; node; node = node.parentElement) {
      const painted = paint(getComputedStyle(node).backgroundColor)
      if (painted && painted[3] > 0.5) return painted
    }
    return [255, 255, 255, 1]
  }

  return Array.from(document.querySelectorAll<HTMLElement>('main *'))
    .filter((el) => el.childElementCount === 0)
    .filter((el) => {
      const text = (el.textContent ?? '').trim()
      return text.length === 1 && !/[\p{L}\p{N}]/u.test(text)
    })
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    .map((el) => {
      const fg = paint(getComputedStyle(el).color)
      if (!fg) return null
      const min = el.closest('[aria-hidden="true"]') ? decorationMin : textMin
      const measured = ratio(fg, backdrop(el))
      if (measured >= min) return null
      return `"${el.textContent?.trim()}" is ${measured.toFixed(2)}:1 (needs ${min}) — ` +
        `<${el.tagName.toLowerCase()} class="${el.className}"> in ${el.parentElement?.tagName.toLowerCase()}`
    })
    .filter((s): s is string => s !== null)
}

type Page = import('@playwright/test').Page

const scan = async (page: Page) =>
  await new AxeBuilder({ page }).withTags(WCAG).disableRules(RULES_OUT_OF_SCOPE).analyze()

/** Scan and judge, including the review-only rules. `where` names the page. */
const expectAccessible = async (page: Page, where: string) => {
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
      const visible = !!probe && (probe.outlined || probe.ringContrast >= RING_MIN_CONTRAST)
      expect(
        visible,
        `${label} (${selector}) must show a focus indicator — ring contrast ${probe?.ringContrast.toFixed(2)}:1`,
      ).toBe(true)
    }
  })

  test('the sign-in button has a focus ring you can see (#186)', async ({ page }) => {
    // The login page was outside this block entirely — the focus test only ever
    // visited /admin/categories — and it is the one page every user passes
    // through. Its submit button was the single control here with no ring
    // colour: `ring-2` alone resolves to `currentcolor`, which on this button is
    // --bp-ink (#ffffff on the shipped primary), over a #fff offset on a white
    // card, with `focus:outline-none` having removed the fallback. The old probe
    // could not have caught it; RING_MIN_CONTRAST is what makes it catchable.
    await page.context().clearCookies()
    await page.goto('/login')

    // Pin the shipped default branding for the duration.
    //
    // This is the whole point of the test and it cannot be left to whatever the
    // database happens to hold: the bug only appears when the operator's primary
    // is DARK. `readableInk` then returns #ffffff for --bp-ink, currentColor on
    // this button becomes white, and an uncoloured `ring-2` is painted white on a
    // #fff offset on a white card. The shipped default (#131921) is exactly that
    // case; the dev database frequently is not — it was holding a mid-tone amber
    // when this was written, whose ink is #101827, and the invisible ring showed
    // up as a perfectly visible dark one. Set on the element rather than through
    // /admin/branding because these are inline custom properties and this test
    // must not mutate shared server state.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[style*="--bp-ink"]')
      root?.style.setProperty('--bp', '#131921')
      root?.style.setProperty('--bp-ink', '#ffffff')
    })

    const controls: [string, string][] = [
      ['email', 'input#email'],
      ['password', 'input#password'],
      ['stay signed in', 'input#rememberMe'],
      ['sign in', 'form button[type="submit"]'],
    ]

    for (const [label, selector] of controls) {
      await page.locator(selector).first().focus()
      await page.waitForTimeout(250)
      const probe = await page.evaluate(focusProbe)
      expect(probe, `${label} did not take focus`).not.toBeNull()
      expect(
        probe!.outlined || probe!.ringContrast >= RING_MIN_CONTRAST,
        `${label} (${selector}) focus ring is ${probe!.ringContrast.toFixed(2)}:1 against what it sits on — 1.4.11 wants ${RING_MIN_CONTRAST}:1`,
      ).toBe(true)
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
        stop.outlined || stop.ringContrast >= RING_MIN_CONTRAST,
        `${stop.id} inside the dialog must show a focus indicator — ring contrast ${stop.ringContrast.toFixed(2)}:1`,
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

  /**
   * Selection, everywhere it is drawn (#186).
   *
   * This used to be one hard-coded assertion on `nav a[aria-current="page"]`,
   * which proved the point for the top nav and nothing else — and the three
   * places that got it WRONG were all somewhere else. Every one of them said
   * "selected" with a background colour and no attribute at all, so the same
   * check that passed on the nav could never have run on them.
   *
   * axe cannot infer any of this: there is no missing attribute to report, only
   * a missing concept.
   */
  test('selection is exposed to assistive tech, not signalled by colour alone', async ({ page }) => {
    await page.goto('/catalog')

    // 1. The top nav — the one case that already worked.
    const currentPage = page.locator('nav a[aria-current="page"]')
    await expect(currentPage).toHaveCount(1)
    await expect(currentPage).toHaveAttribute('href', '/catalog')

    // 2. The catalogue's category filters. They are toggles, so aria-pressed:
    //    exactly one is pressed at rest ("All products"), and clicking a
    //    category moves it. Without this a filtered result set and a broken
    //    one are indistinguishable to a screen-reader user.
    const filters = page.locator('aside button[aria-pressed]')
    await expect(filters.first()).toBeVisible({ timeout: 30000 })
    await expect(page.locator('aside button[aria-pressed="true"]')).toHaveCount(1)

    const category = filters.nth(1)
    if (await category.count()) {
      await category.click()
      await expect(category).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('aside button[aria-pressed="true"]')).toHaveCount(1)
    }

    // 3. The language menu: 25 buttons that used to announce identically.
    await page.getByRole('button', { name: /language/i }).first().click()
    const languages = page.locator('button[aria-current]')
    await expect(languages).toHaveCount(1)
    await expect(languages).toContainText('EN')
  })

  /**
   * The required-field marker, which axe excludes from contrast BY CONSTRUCTION
   * (#185).
   *
   * `colorContrastMatches` gates on `hasRealTextChildren`, which calls
   * `removeUnicode(visibleText, { punctuations: true })` first. `*` is
   * punctuation, so the stripped string is empty, the function returns false and
   * the element is dropped from `color-contrast` entirely. No viewport, branding
   * colour or rule configuration changes that — it is a permanent hole for ANY
   * glyph-only indicator: asterisks, dots, bullets, chevrons, dashes. The
   * component suite cannot help either; it disables `color-contrast` outright
   * because jsdom has no layout.
   *
   * So it is measured here. Scope is deliberately "elements whose entire visible
   * text is a single non-alphanumeric glyph", not just the asterisk, because the
   * class is what recurs.
   */
  test('glyph-only indicators meet contrast, which axe cannot check for them', async ({ page }) => {
    // Two pages with required markers on different grounds: white card and the
    // slate-tinted admin form.
    for (const path of ['/admin/products/new', '/admin/parameters']) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible({ timeout: 30000 })

      const failures = await page.evaluate(glyphOnlyContrast, [AA_BODY, RING_MIN_CONTRAST] as [number, number])
      expect(failures, `${path}:\n  ${failures.join('\n  ')}`).toEqual([])
    }
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

      await first.click()
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
