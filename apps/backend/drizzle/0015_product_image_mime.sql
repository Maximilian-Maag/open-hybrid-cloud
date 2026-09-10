-- The image was stored without its type, and the serving route answered every
-- request with `image/png` regardless of what was uploaded (see
-- lib/services/catalog.ts getProductImage). Branding already stores its logo's
-- mime type; products now do the same.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "image_mime" text;
