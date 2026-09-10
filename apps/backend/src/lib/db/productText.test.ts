import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { products, productTranslations } from '@/lib/db/schema'
import { createCategory, createProduct } from '@/test/helpers'
import { productNameSql, productDescriptionSql, productLongDescriptionSql } from './productText'

/**
 * Issue #162. The catalogue read product text through a four-step fallback and
 * everything else — the cart, the order list and detail, the approvals queue,
 * the infrastructure list and search, the cost report and its export, the admin
 * product list, the notification subject line — hardcoded `language_code = 'en'`.
 *
 * These exercise the shared expression those paths now share, because that is
 * where "which language did this row come from" is decided. The call sites are
 * covered by their own service tests; what has to be pinned HERE is each arm of
 * the chain, since a chain that silently loses an arm still returns a string and
 * still looks right in every one of them.
 */
const withTranslations = async (
  rows: Array<{ lang: string; name: string; description?: string; longDescription?: string }>,
) => {
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'seed-en')
  // `createProduct` seeds an `en` row; start from a clean slate so a test that
  // means "no English translation" actually has none.
  await db.delete(productTranslations).where(eq(productTranslations.productId, product.id))
  for (const row of rows) {
    await db.insert(productTranslations).values({
      productId: product.id,
      languageCode: row.lang,
      name: row.name,
      description: row.description ?? '',
      longDescription: row.longDescription ?? '',
    })
  }
  return product
}

const read = async (productId: number, lang: string) => {
  const [row] = await db
    .select({
      name: productNameSql(lang),
      description: productDescriptionSql(lang),
      longDescription: productLongDescriptionSql(lang),
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
  return row
}

describe('the product-text fallback chain (#162)', () => {
  it('prefers the reader\'s own language', async () => {
    const product = await withTranslations([
      { lang: 'en', name: 'Virtual Machine' },
      { lang: 'de', name: 'Virtuelle Maschine' },
    ])

    expect((await read(product.id, 'de')).name).toBe('Virtuelle Maschine')
    expect((await read(product.id, 'en')).name).toBe('Virtual Machine')
  })

  it('falls back to English when the reader\'s language has no row', async () => {
    const product = await withTranslations([{ lang: 'en', name: 'Virtual Machine' }])

    expect((await read(product.id, 'pl')).name).toBe('Virtual Machine')
  })

  it('falls back to German when there is no English either', async () => {
    const product = await withTranslations([
      { lang: 'de', name: 'Virtuelle Maschine' },
      { lang: 'fr', name: 'Machine virtuelle' },
    ])

    expect((await read(product.id, 'pl')).name).toBe('Virtuelle Maschine')
  })

  // The arm that matters most in practice: the admin form used to offer four of
  // the 25 languages, so a product translated only into one of the other 21 is
  // ordinary. Without this arm it has no name outside the catalogue, and the
  // frontend renders its `Product #7` placeholder.
  it('falls back to any translation at all rather than to nothing', async () => {
    const product = await withTranslations([{ lang: 'mt', name: 'Magna Virtwali' }])

    expect((await read(product.id, 'pl')).name).toBe('Magna Virtwali')
  })

  it('gives the name and the description the same answer', async () => {
    // These two chains used to disagree on their last arm — description ended at
    // `''` — so a French-only product read in Polish rendered a French title
    // above an empty description.
    const product = await withTranslations([
      { lang: 'fr', name: 'Machine virtuelle', description: 'Une VM' },
    ])

    const row = await read(product.id, 'pl')
    expect(row.name).toBe('Machine virtuelle')
    expect(row.description).toBe('Une VM')
  })

  // The long description deliberately does NOT fall back to any translation: a
  // wall of the wrong language is worse than the page omitting the section.
  it('leaves the long description empty rather than showing a wall of another language', async () => {
    const product = await withTranslations([
      { lang: 'fr', name: 'Machine virtuelle', longDescription: 'Un long texte.' },
    ])

    expect((await read(product.id, 'pl')).longDescription).toBe('')
  })

  // `long_description` is NOT NULL DEFAULT '', and COALESCE('', 'the English
  // text') is ''. Without NULLIF on every arm the fallback fired only when the
  // whole translation ROW was missing, so a language with a row and an empty
  // long text — what the demo seed creates for `de` — showed no story at all.
  it('treats an empty long description as absent, not as an answer', async () => {
    const product = await withTranslations([
      { lang: 'de', name: 'Virtuelle Maschine', longDescription: '' },
      { lang: 'en', name: 'Virtual Machine', longDescription: 'A long story.' },
    ])

    expect((await read(product.id, 'de')).longDescription).toBe('A long story.')
  })

  it('returns null for a product with no translations at all', async () => {
    const product = await withTranslations([])

    expect((await read(product.id, 'en')).name).toBeNull()
  })
})
