-- The product page as a shop page (issue #107): several pictures per product, a
-- long description, and the few facts a buyer needs before ordering.
--
-- One image per product was a column on `products`, which is why the detail page
-- had a picture and no gallery. Images move into their own table so a product can
-- have an ordered set of them.
CREATE TABLE IF NOT EXISTS "product_images" (
  "id"         BIGSERIAL PRIMARY KEY,
  "product_id" BIGINT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- 0-based, dense, and the gallery's order. Deliberately NOT unique per product:
  -- a reorder that swaps two positions in one statement violates a non-deferrable
  -- unique index mid-statement, and the workaround (a pass through negative
  -- positions) buys nothing here — every read orders by ("position", "id"), so a
  -- transient tie is still deterministic.
  "position"   INT NOT NULL DEFAULT 0,
  "data"       BYTEA NOT NULL,
  "mime"       TEXT NOT NULL,
  -- NOT NULL, unlike the products.image_alt it replaces: this table only ever has
  -- a row when there is an image, so "an image with no description" (#105) is
  -- expressible in the column here rather than only in the service. The service
  -- still rejects a blank one — NOT NULL cannot.
  "alt"        TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read is "this product's images, in gallery order".
CREATE INDEX IF NOT EXISTS "product_images_product_position_idx"
  ON "product_images" ("product_id", "position");

-- The existing single picture becomes the first image of the gallery. COALESCE on
-- the mime type mirrors what the serving route already assumed for rows written
-- before it was recorded; the alt fallback chain is 0016's, because alt is NOT
-- NULL here and a legacy row with a blank description cannot be carried over as
-- one.
INSERT INTO "product_images" ("product_id", "position", "data", "mime", "alt")
SELECT
  p."id",
  0,
  p."image",
  COALESCE(p."image_mime", 'image/png'),
  COALESCE(
    NULLIF(TRIM(p."image_alt"), ''),
    (SELECT NULLIF(TRIM(t."name"), '') FROM "product_translations" t
      WHERE t."product_id" = p."id" AND t."language_code" = 'en' LIMIT 1),
    (SELECT NULLIF(TRIM(t."name"), '') FROM "product_translations" t
      WHERE t."product_id" = p."id" LIMIT 1),
    'Product #' || p."id"
  )
FROM "products" p
WHERE p."image" IS NOT NULL;

-- Dropped rather than left readable: two places to look for "the product's
-- picture" is two answers the day they disagree, and the only writer of these
-- columns was the admin image endpoint, which now writes the table above. The
-- alt text the rest of the API still exposes as `imageAlt` is read from the
-- first gallery image.
ALTER TABLE "products" DROP COLUMN IF EXISTS "image";
ALTER TABLE "products" DROP COLUMN IF EXISTS "image_mime";
ALTER TABLE "products" DROP COLUMN IF EXISTS "image_alt";

-- The tile and the detail page shared one `description`, so it had to stay short
-- enough for a card. The long one is per translation like the short one, and only
-- the detail page reads it.
ALTER TABLE "product_translations"
  ADD COLUMN IF NOT EXISTS "long_description" TEXT NOT NULL DEFAULT '';

-- The two facts a buyer asks about that the schema could not answer. Free text
-- rather than a users FK for the owner: what a shopper wants is the team that
-- runs the thing, which is usually not a portal account.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "owner" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "docs_url" TEXT;
