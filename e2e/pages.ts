/**
 * The routes every page-level gate walks.
 *
 * Extracted from a11y.spec.ts so the reflow gate (WCAG 1.4.10) and the axe gate
 * cover exactly the same set: two hand-maintained copies of this list would drift,
 * and the page that fell out of one of them is precisely the page that ships
 * broken.
 *
 * Static routes only — detail pages carry an id, so they are walked in from their
 * list page instead (see the detail-page block in a11y.spec.ts).
 */

/** Reachable without a session. Neither renders the dashboard shell. */
export const PUBLIC_PAGES = ['/login', '/impressum']

export const AUTHED_PAGES = [
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
