# Accessibility: what the gate asserts, and what it does not

The automated gate is `e2e/a11y.spec.ts` (pages, dialogs, focus, branding) plus
`apps/frontend/src/components/a11y.test.tsx` (axe over the primitives, no browser).

**Target: WCAG 2.1 A and AA everywhere, plus the AAA criteria listed as in scope
below.** The A/AA half is a hard gate — a violation fails CI. The AAA half is a
deliberately partial claim, and this document is the record of which parts were
taken and which were refused, because "we aim for AAA" without that record is
indistinguishable from not having looked.

Three things worth knowing before reading the table:

- **The gate asks for `best-practice` as well as the WCAG tags.** Of the 105 rules
  axe-core 4.13.0 ships, 30 carry `best-practice` and no `wcagNNN` tag, so a tag
  list of `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` never ran them (#185). They are
  the structural checks nothing else here performs — `heading-order`,
  `page-has-heading-one`, `empty-heading`, `region`, `landmark-one-main`,
  `landmark-unique`, `skip-link`, `tabindex`, `empty-table-header` — and on the
  first run they found that `/` and `/catalog` had no `<h1>`, that `/login` and
  the unconfigured `/impressum` had no landmark at all, and that every page built
  from `PageHeader` + `Card` went h1 → h3 because `Card` hardcoded its title's
  level. Three of axe's rules are still not requested, deliberately:
  `duplicate-id` and `duplicate-id-active` are tagged `deprecated` (4.1.1 was
  removed from WCAG 2.2), and `target-size` is the 2.2 AA criterion 2.5.8 at 24px,
  which the 44px 2.5.5 probe below already exceeds.
- **axe has three AAA rules.** `color-contrast-enhanced` (1.4.6),
  `identical-links-same-purpose` (2.4.9) and `meta-refresh-no-exceptions`
  (2.2.4/3.2.5). All three are `enabled: false` by default; requesting the
  `wcag2aaa` tag runs them anyway (`matchTags` skips the `enabled` check when a
  tag matches explicitly). Everything else in the AAA column is either
  unautomatable or asserted by hand at the bottom of the spec.
- **`identical-links-same-purpose` can never produce a violation.** When it finds
  two links with the same name and different destinations it sets the result to
  `undefined`, which axe reports as *incomplete*, not *failed*. The spec therefore
  asserts on `incomplete` for that rule specifically. Without that it would be
  decoration.

## AAA criteria: in scope

| Criterion | How it is enforced |
|---|---|
| **2.4.8 Location** | `Breadcrumbs` on every detail page — order, project, infrastructure element, catalogue product, admin product, new product. Asserted: `nav[aria-label]` → `ol` → last crumb carries `aria-current="page"`. The product page previously had an ad-hoc `<nav>` named "Catalog", which reads as a second navigation landmark rather than a location; a "Back to Orders" button says where you can go, not where you are. |
| **2.4.9 Link Purpose (Link Only)** | `identical-links-same-purpose` via the `wcag2aaa` tag, with `incomplete` treated as failure. Three real findings fixed: twenty "Details" links on `/catalog`, one "Edit" link per row on `/admin/products`, and infrastructure rows named only by their product (two elements from one product collide). Each got a visually hidden qualifier, so the visible label still starts the accessible name — 2.5.3 Label in Name would break if the name replaced it instead. |
| **2.5.5 Target Size** | 44x44 CSS px, asserted by an explicit probe (axe has no rule for it — its `target-size` rule is WCAG 2.2 **AA**, 24px). `Button` carries `min-h-11 min-w-11` in its base classes, so no size or caller `className` can drop below it; `Input`, `Select`, the modal close, the toast dismiss, the cart link, the language switcher, the account menu, the header search, the catalogue category filters and every `<Link>` deliberately styled as a button got the same floor. Scope is **controls**: `button`, `summary`, `select`, single-line `input`, `[role="button"]`. See the exclusions for what is not. |
| **2.3.3 Animation from Interactions** | Already asserted before this pass: the reduced-motion test proves the animation collapses *and* that it animates without the preference, so it cannot pass by animating nothing. |
| **2.2.4 Interruptions / 3.2.5 Change on Request** | `meta-refresh-no-exceptions` via the `wcag2aaa` tag. Free — there is no `<meta refresh>` anywhere and this keeps it that way. |
| **1.4.9 Images of Text** | No images of text. The operator's logo is exempt (logotype). |
| **2.5.6 Concurrent Input Mechanisms** | Nothing locks input to one modality. |

## AAA criteria: out of scope, with the reason

### 1.4.6 Contrast (Enhanced) — 7:1

**Refused as a page-level gate. `color-contrast-enhanced` stays disabled in the
spec, and the reason is arithmetic, not effort.**

The portal chrome — header, nav, hero, footer, filled primary buttons — is painted
on a colour the *operator* chooses. `readableInk` picks the better of two fixed
inks (`#101827` / `#ffffff`) against it, and for a wide band of mid-tones neither
reaches 7:1. Measured with the real helper:

| Operator colour | Best ink | Ratio | AA | AAA |
|---|---|---|---|---|
| `#131921` (shipped default) | white | 17.67 | yes | yes |
| `#febd69` (shipped secondary) | dark | 10.74 | yes | yes |
| `#1d4ed8` blue | white | 6.70 | yes | **no** |
| `#0ea5e9` sky | dark | 6.41 | yes | **no** |
| `#ca8a04` amber | dark | 6.05 | yes | **no** |
| `#16a34a` green | dark | 5.39 | yes | **no** |
| `#e11d48` rose | white | 4.70 | yes | **no** |

There is no fix available to the app: the background is the brand, and the only
two candidate inks are already the extremes. Anything that made these pass would
be overriding the operator's colour, which is the whole feature. So 1.4.6 cannot
be green on any page that renders the chrome — which is every page — and enabling
the rule would produce a permanently red gate that people learn to ignore.

Two things were done instead of fudging it:

1. **The half we *can* move was moved to 7:1.** `readableAccent` *derives* a
   colour rather than choosing between two, so 7:1 is always reachable, and its
   default target is now `AAA_BODY`. This governs `--bp-text`: the brand colour
   used as text on the app's own surfaces. It costs no recognisability that AA had
   not already spent — `#febd69` came out of the AA derivation as `#8e693b`, a
   brown; AAA makes it `#694e2c`. `contrast.test.ts` locks the 7:1 in.
2. **The operator is told.** `/admin/branding` now reports the achieved ratio
   against both thresholds ("meets WCAG AA. AAA would need 7:1"), because they are
   the only person who can make the trade. It stays informational — AA is the
   level this app conforms to, and failing AAA is not a blocker.

The second, smaller gap, recorded rather than fixed: the muted text tier
(`text-slate-500`, 86 uses) measures 4.76:1 on white and 4.34:1 on `slate-100`.
Reaching 7:1 means `slate-600` on white (7.58) or `slate-700` on the tinted
surfaces (`slate-600` on `#f1f5f9` is 6.92 — it misses), which collapses the muted
tier into the primary one and flattens the typographic hierarchy across 36 files.
That would be a whole-app visual change bought for a criterion that reason (1)
already makes unattainable at page level, so it was not made.

### 2.5.5 Target Size — the parts not claimed

- **Content links.** Table-cell links, the footer row, breadcrumb crumbs, "View
  all". These sit in dense lines of text a few pixels apart; a 44px box per link
  either overlaps its neighbours or doubles the height of the layout. The rows
  they sit in are already 44px (`Table` uses `py-3` on `text-sm`) and, where the
  table opts into `onRowClick`, the whole row is the target.
- **Native checkboxes**, ~20 of them across the admin forms. A `<input
  type="checkbox">` renders at ~13px and Tailwind does not resize it; making each
  a 44px target means restructuring every label row it sits in. Recorded as a real
  gap, not exempt.
- **Native file inputs** (`type="file"`) — the button inside them is drawn by the
  user agent, which is 2.5.5's "User agent control" exception.

The 44px floor is a real minimum height, not an invisible expanded hit area. The
pseudo-element trick (keep the 28px box, stretch the target with an absolutely
positioned 44px `::before`) was considered and rejected: these buttons sit 8px
apart in table rows and card headers, so the invisible targets would overlap, and
a target you cannot see the edges of that steals its neighbour's clicks is worse
for the motor-impaired users 2.5.5 exists for. Rows got taller instead.

### 1.4.8 Visual Presentation

Five requirements, and the first is a mechanism for the user to choose foreground
and background colours. This app has *operator*-chosen branding, not per-user
theming; building a user-level colour picker is a product decision, not an
accessibility fix. Two of the other four are measured and one is asserted:

- Text is never justified — asserted in the spec, cheap and a real regression guard.
- Line spacing must be at least 1.5 within a paragraph. Tailwind's defaults for
  the two sizes this app uses for body copy are below it: `text-sm` is 1.43
  (20px/14px) and `text-xs` is 1.33 (16px/12px). Raising them is a global
  re-typesetting job, and it cannot rescue the criterion on its own.

### 3.1.5 Reading Level — excluded explicitly

The content is a cloud-provisioning console: environment names, Terraform outputs,
pipeline ids, cost centres. There is no lower secondary reading level version of
"Callback secret — inbound pipeline events" that is still the thing the operator
needs. Nothing here is prose that a plain-language rewrite would serve.

### 3.3.5 Help

`Input` and `Select` take a `hint`, wired to `aria-describedby`, and the harder
fields use it. That is per-field help, but 3.3.5 wants it *available* for the
forms that need it, and there is no help surface in the product — no docs link, no
per-field explanation for the admin forms, which are the ones that need it most.
Adding one is a documentation project. Recorded as partially met, not claimed.

### The rest of AAA

| Criterion | Why not |
|---|---|
| 1.2.6 Sign Language, 1.2.8 Media Alternative, 1.2.9 Audio-only (Live), 1.4.7 Low or No Background Audio | No audio or video anywhere in the product. Not applicable rather than unmet. |
| 2.1.3 Keyboard (No Exception) | Plausibly met — every control is a native element and the dialogs are `<dialog>` — but "no exception" is a claim about paths nobody has walked. Not asserted, so not claimed. |
| 2.2.3 No Timing, 2.2.5 Re-authenticating, 2.2.6 Timeouts | The session expires. `expiredLoginUrl` returns you to the page you were on (#103), which is most of 2.2.5, but nothing warns before the timeout or preserves unsaved form data, which is 2.2.6. |
| 2.3.2 Three Flashes | Met by construction: nothing flashes. |
| 2.4.10 Section Headings | Largely met — `Card` titles are real headings, every page has an `h1`, and both are now *checked* (`page-has-heading-one` and `heading-order`) rather than asserted in prose; this row claimed the h1 while `/` and `/catalog` had none. "Organised using section headings" is still a judgement about content structure, not something a rule can check. |
| 3.1.3 Unusual Words, 3.1.4 Abbreviations, 3.1.6 Pronunciation | The UI is dense with abbreviations (CI, SMTP, TLS, CSV, VM, `TF_VAR_`). Expanding them properly means a glossary in 25 languages. Real gap. |
| 3.3.6 Error Prevention (All) | Every destructive action is behind a confirmation modal, which covers reversal for deletes. Submissions are not reviewable-before-final in general. |

## When you add a page or a component

- A new route is not scanned until it is listed in `AUTHED_PAGES` / `PUBLIC_PAGES`
  or reached by the detail-page block. The gate covers what it is told to cover.
  **The policy gate now says so**: `page_is_in_the_a11y_gate` (`policy/a11y.rego`)
  compares the route tree against those two arrays and denies a static page that
  is not on either. It exists because forgetting the list does not turn the suite
  red — it reports the same green result it did before the page existed, so the
  gate quietly stops covering the app while continuing to look like it does.
- The five detail pages — `/orders/[id]`, `/projects/[id]`, `/catalog/[id]`,
  `/infrastructure/[id]`, `/admin/products/[id]` — are **not** scanned, and the
  same rule warns about each. A static path list cannot name them: reaching one
  needs a seeded record. They are where the tables, forms and status panels live,
  so they are also the pages most likely to have a defect. The warning is there to
  keep that gap stated rather than implied by the list's silence.
- A new UI primitive is not checked until it is in `a11y.test.tsx`. jsdom cannot do
  `color-contrast` (no layout, no canvas), so contrast stays an e2e concern.
- **A glyph-only indicator is invisible to `color-contrast`.** The rule matches an
  element only if `hasRealTextChildren` accepts it, and that helper strips
  punctuation first — so a lone `*`, `·`, `›` or `—` leaves an empty string and
  the element is dropped from the check. No configuration changes this. That is
  how the required-field asterisk shipped at 3.82:1 on white (#185). The e2e gate
  measures the class itself: `glyphContrast` in `a11y.spec.ts` runs on every page
  and dialog it already loads, and `the required-field marker is found and
  measured` proves the probe still matches something, because a measurement that
  finds nothing passes exactly like a clean one.
- **Heading levels are a page property, so a component cannot own one.** `Card`,
  `ProductCard` and the admin environment rows take a `level` prop for that
  reason: the same card sits under an `<h1>` in one grid and under an `<h2>` in
  another, and a hardcoded level is a `heading-order` failure in whichever place
  it is wrong.
- A new control needs the 44px floor. `Button`, `Input` and `Select` carry it; a
  hand-rolled `<button>` does not.
