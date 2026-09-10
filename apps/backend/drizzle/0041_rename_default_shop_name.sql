-- The portal is called InfraShelf now, so the default a fresh install starts
-- with changes with it.
ALTER TABLE "branding" ALTER COLUMN "shop_name" SET DEFAULT 'InfraShelf';
--> statement-breakpoint
-- SET DEFAULT touches only rows inserted from here on, so an install that never
-- opened Admin → Branding would keep showing the old product name forever. The
-- UPDATE is scoped to the exact previous default: a row that says anything else
-- is an operator's own choice and is left alone.
UPDATE "branding" SET "shop_name" = 'InfraShelf' WHERE "shop_name" = 'Open Hybrid Cloud';
