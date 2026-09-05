import type { ParameterType } from '@open-hybrid-cloud/types'
import { t } from '@/lib/i18n'

/**
 * The parameter types, and their labels, for every screen that offers a choice.
 *
 * A `Record<ParameterType, …>` rather than a list, so adding a type to
 * `ParameterType` fails to compile until it has a label. That is the whole
 * point: `size` was added to the type, and the product page's parameter editor
 * — which wrote its four options out by hand — never heard about it. The global
 * parameters admin, which already derived its list this way, had it from the
 * start. One screen offered T-shirt sizes and the other did not, for months,
 * and nothing anywhere said so (#313).
 *
 * Order matters and is the order below: the three primitives, then the two that
 * take extra configuration.
 */
const TYPE_KEYS: Record<ParameterType, 'typeString' | 'typeNumber' | 'typeBoolean' | 'typeDropdown' | 'typeSize'> = {
  string: 'typeString',
  number: 'typeNumber',
  bool: 'typeBoolean',
  dropdown: 'typeDropdown',
  size: 'typeSize',
}

/** One type's label, for a badge or a summary line. */
export const parameterTypeLabel = (type: ParameterType, lang: string): string =>
  t(TYPE_KEYS[type], lang)

/** Options for a `<Select>`, in the reader's language. */
export const parameterTypeOptions = (lang: string): { value: ParameterType; label: string }[] =>
  (Object.keys(TYPE_KEYS) as ParameterType[]).map((value) => ({ value, label: t(TYPE_KEYS[value], lang) }))
