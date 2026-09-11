-- A cost centre can carry a budget, and say what happens when it is spent (#325).
--
-- Four nullable columns rather than a table of their own: a cost centre has at
-- most one budget, and `budget_amount IS NULL` is what "no budget" looks like,
-- so a row untouched by this migration behaves exactly as it did before it.
--
-- The four CHECKs are the half of the contract TypeScript cannot hold: all four
-- columns together or none of them, the two enums, and an amount that is not
-- negative (zero is how new spend is stopped deliberately).
ALTER TABLE "cost_centers" ADD COLUMN "budget_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "budget_currency" text;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "budget_period" text;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "budget_behaviour" text;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_budget_complete" CHECK (("cost_centers"."budget_amount" IS NULL AND "cost_centers"."budget_currency" IS NULL AND "cost_centers"."budget_period" IS NULL AND "cost_centers"."budget_behaviour" IS NULL) OR ("cost_centers"."budget_amount" IS NOT NULL AND "cost_centers"."budget_currency" IS NOT NULL AND "cost_centers"."budget_period" IS NOT NULL AND "cost_centers"."budget_behaviour" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_budget_period" CHECK ("cost_centers"."budget_period" IS NULL OR "cost_centers"."budget_period" IN ('total','monthly'));--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_budget_behaviour" CHECK ("cost_centers"."budget_behaviour" IS NULL OR "cost_centers"."budget_behaviour" IN ('warn','block'));--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_budget_amount_positive" CHECK ("cost_centers"."budget_amount" IS NULL OR "cost_centers"."budget_amount" >= 0);
