import { sql, type SQL, type Column } from 'drizzle-orm'
import { products } from './schema'

/**
 * One definition of "the product's name, in the reader's language".
 *
 * FA-12.3 says product content is loaded language-specifically from a
 * translation table, and FA-02.4 says it is multilingual in all 25 languages.
 * Three different implementations of that lookup existed and only one honoured
 * it: the catalogue took a `lang` and fell back four ways, while the cart, the
 * order list and detail, the approvals queue, the infrastructure list, the cost
 * dashboard and its export, the admin product list and every notification
 * subject line each hardcoded `language_code = 'en'` with no fallback (#162).
 *
 * The user-visible result was one session crossing all three: a German user saw
 * *Virtuelle Maschine* in the catalogue, *Virtual Machine* in their own cart and
 * order history — and, for a product translated only into German, `Product #7`,
 * because the hardcoded join simply found no row.
 *
 * ## The chain
 *
 * 1. the reader's language
 * 2. English — the language the seed and the admin mirror always write
 * 3. German — this deployment's other near-universal language
 * 4. any translation at all
 *
 * Step 4 matters more than it looks. Only four of the 25 languages were offered
 * in the admin product form, so a `fr`-only product is ordinary rather than
 * exotic, and without step 4 it has no name anywhere outside the catalogue.
 * Showing a French name to a Polish reader is worse than showing their own and
 * better than showing `Product #7`.
 *
 * ## Why SQL and not a join
 *
 * The name is searched and sorted on, not only displayed — `GET /infrastructure`
 * matches a search term against it and orders by it. A correlated subquery can
 * appear in SELECT, WHERE and ORDER BY alike, so all three agree by
 * construction. A `leftJoin` on one language cannot, which is how the
 * infrastructure search came to look for a name the user was never shown.
 */

/**
 * The product id these subqueries correlate against.
 *
 * Any column, not just `products.id`: the cart correlates on
 * `cart_items.product_id` and the cost report on its own joined column, and
 * forcing those call sites to join `products` purely to have the right column in
 * scope is how the cart picked up a cross join the last time.
 */
type ProductIdColumn = Column | SQL

const chain = (column: string, productId: ProductIdColumn, lang: string, last: SQL): SQL =>
  sql`COALESCE(
    (SELECT ${sql.raw(column)} FROM product_translations WHERE product_id = ${productId} AND language_code = ${lang}),
    (SELECT ${sql.raw(column)} FROM product_translations WHERE product_id = ${productId} AND language_code = 'en'),
    (SELECT ${sql.raw(column)} FROM product_translations WHERE product_id = ${productId} AND language_code = 'de'),
    ${last}
  )`

/** Any translation, in no particular order — the last resort before nothing. */
const anyTranslation = (column: string, productId: ProductIdColumn): SQL =>
  sql`(SELECT ${sql.raw(column)} FROM product_translations WHERE product_id = ${productId} LIMIT 1)`

/**
 * The product's name in `lang`, falling back through English, German and then
 * any translation. Never null for a product that has at least one translation,
 * which every product created through the admin API does.
 */
export const productNameSql = (lang: string, productId: ProductIdColumn = products.id): SQL<string> =>
  chain('name', productId, lang, anyTranslation('name', productId)) as SQL<string>

/**
 * The product's short description in `lang`.
 *
 * Same last arm as the name, deliberately. The two chains used to disagree —
 * description ended at `''` — so a product translated only into French, read in
 * Polish, rendered a French title above an empty description. Whatever the right
 * answer is for an untranslated product, the title and the description have to
 * give the same one.
 */
export const productDescriptionSql = (
  lang: string,
  productId: ProductIdColumn = products.id,
): SQL<string> =>
  chain('description', productId, lang, anyTranslation('description', productId)) as SQL<string>

/**
 * The product's long description in `lang`, or `''`.
 *
 * Two differences from the other two, both intentional:
 *
 * - the last arm is `''`, not "any translation". An untranslated long text is a
 *   wall of the wrong language, and the product page omits the section entirely
 *   when it is empty — which is a better page than one paragraph of French.
 * - every arm is wrapped in NULLIF, because `long_description` is NOT NULL
 *   DEFAULT `''` and `COALESCE('', 'the English text')` is `''`. Without it the
 *   fallback fired only when the whole translation ROW was missing, so a
 *   language with a row and an empty long text — what the demo seed creates for
 *   `de` — showed no story at all. Measured against Postgres, not assumed.
 */
export const productLongDescriptionSql = (
  lang: string,
  productId: ProductIdColumn = products.id,
): SQL<string> =>
  sql<string>`COALESCE(
    NULLIF((SELECT long_description FROM product_translations WHERE product_id = ${productId} AND language_code = ${lang}), ''),
    NULLIF((SELECT long_description FROM product_translations WHERE product_id = ${productId} AND language_code = 'en'), ''),
    NULLIF((SELECT long_description FROM product_translations WHERE product_id = ${productId} AND language_code = 'de'), ''),
    ''
  )`
