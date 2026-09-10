/**
 * The chart palette (issue #106).
 *
 * There is exactly one colour to spend on a chart in this app: the operator's
 * primary. The dashboard layout derives an ordered ramp from it with
 * `accentRamp`, every step of which clears WCAG 1.4.11's 3:1 against the card it
 * is painted on, and publishes the steps as `--chart-1 … --chart-N`. Charts read
 * them from here rather than refetching the branding on every page.
 *
 * The fallbacks are the ramp of the shipped default primary (#131921), so a chart
 * rendered outside the dashboard layout — a unit test, a Storybook-style harness —
 * still paints something legible instead of `fill: ''`.
 *
 * Ordered darkest first, and used in the order the data is sorted in, so the tone
 * tracks magnitude. Tone is never the only channel: every chart that uses more than
 * one step ships a legend or table carrying the label and the value as text.
 */
const FALLBACK = ['#3f434a', '#484c53', '#53575d', '#60646a', '#72757a', '#8b8e92'] as const

/**
 * How many segments a stacked chart may draw. Six because part-to-whole stops being
 * readable past that — adjacent shares blur and no ramp can separate them — so the
 * charts fold their tail into "Other" rather than growing the palette.
 */
export const CHART_STEPS = FALLBACK.length

/** `var(--chart-n, fallback)`, darkest first. */
export const CHART_FILL: string[] = FALLBACK.map((hex, i) => `var(--chart-${i + 1}, ${hex})`)

/** The strongest step — what a single-series chart paints with. */
export const CHART_PRIMARY = CHART_FILL[0]

/** A de-emphasised step, for the "previous period" half of a comparison. */
export const CHART_MUTED = CHART_FILL[4]

/** Hairline grid rules: one step off the card, never dashed. */
export const CHART_GRID = '#e2e8f0'

/**
 * The baseline a chart sits on — one step darker than CHART_GRID.
 *
 * Deliberately not the same value: the axis is the chart's edge and has to read
 * as more than the gridlines it terminates. It was a bare `#cbd5e1` in
 * `CostTrend.tsx` while this file's doc claimed CHART_GRID covered "grid and
 * axis rules", so the two disagreed and neither said which was intended
 * (#195). Naming it is the whole fix; the painted colour is unchanged.
 */
export const CHART_AXIS = '#cbd5e1'
