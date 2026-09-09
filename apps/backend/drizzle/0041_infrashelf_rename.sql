-- The project is now called InfraShelf. The branding row's shop_name default
-- follows for databases created from here on.
--
-- Existing rows keep whatever shop_name they hold: the value is the operator's
-- setting, not ours to rewrite, and a rename is exactly the moment an admin
-- reviews the branding page anyway.

ALTER TABLE "branding" ALTER COLUMN "shop_name" SET DEFAULT 'InfraShelf';
