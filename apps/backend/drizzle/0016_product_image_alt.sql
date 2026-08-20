-- Every image needs a description: WCAG 1.1.1 is a Level A criterion, and until
-- now each component decided on its own whether a product picture was decorative
-- (the catalogue tile and the cart thumbnail passed an empty alt; the product page
-- used the product name). That is a decision about meaning, and it belongs to
-- whoever uploaded the picture.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "image_alt" text;

-- Existing images get the product's English name, which is honest as a starting
-- point and lets the rule be enforced for everything new. A product with no
-- translation at all is valid under this schema, so the last COALESCE arm is not
-- decoration: without it those rows would keep image_alt NULL and be the one
-- thing this migration exists to rule out — an image with no description. The
-- fallback matches how the UI already names an untranslated product.
UPDATE "products" p
SET "image_alt" = COALESCE(
  (SELECT NULLIF(TRIM(t."name"), '') FROM "product_translations" t
    WHERE t."product_id" = p."id" AND t."language_code" = 'en' LIMIT 1),
  (SELECT NULLIF(TRIM(t."name"), '') FROM "product_translations" t
    WHERE t."product_id" = p."id" LIMIT 1),
  'Product #' || p."id"
)
WHERE p."image" IS NOT NULL AND (p."image_alt" IS NULL OR TRIM(p."image_alt") = '');
