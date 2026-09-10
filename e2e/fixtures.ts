import { test as base, expect } from '@playwright/test'
import { hydrated } from './helpers'

/**
 * `page`, but a `goto` that comes back when the page is actually usable.
 *
 * Playwright's actionability checks cannot see hydration. A Next.js `<Link>` is
 * in the server-rendered HTML, so it is visible, enabled and stable — and
 * clicking it before React has mounted the router follows nothing at all. The
 * click reports success, the page stays where it is, and the failure surfaces
 * later as a URL assertion timing out, which reads as a routing bug rather than
 * a timing one.
 *
 * That was invisible while the e2e database was empty: the tests that click a
 * row skipped for want of a row. Seeding the database made them run, and they
 * are flaky in exactly this shape — a first attempt where nothing moved and a
 * retry that passes (#152, #296).
 *
 * Wrapping `goto` rather than annotating call sites: there are 249 `.click()`s
 * in this suite, and a rule that has to be remembered at each of them is a rule
 * that will be forgotten at the next one. Every spec imports `test` from here.
 *
 * It does not cover in-app navigation — after a click that changes the page,
 * the NEXT interaction may still race. Those are the minority and get an
 * explicit `hydrated(page)`; the a11y detail-page tests navigate by `href`
 * instead, which sidesteps it entirely.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (url, options) => {
      const response = await goto(url, options)
      await hydrated(page)
      return response
    }
    await use(page)
  },
})

export { expect }
