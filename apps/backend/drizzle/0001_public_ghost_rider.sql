CREATE TABLE "pipeline_stacks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text NOT NULL,
	"webhook_token" text NOT NULL,
	"state_key_param" text DEFAULT 'hostname' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
UPDATE "branding" SET "primary_color" = '#131921', "secondary_color" = '#febd69' WHERE id = 1 AND "primary_color" = '#1e40af' AND "secondary_color" = '#3b82f6';--> statement-breakpoint
ALTER TABLE "branding" ALTER COLUMN "primary_color" SET DEFAULT '#131921';--> statement-breakpoint
ALTER TABLE "branding" ALTER COLUMN "secondary_color" SET DEFAULT '#febd69';--> statement-breakpoint
ALTER TABLE "pipeline_stacks" ADD CONSTRAINT "pipeline_stacks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stacks" ADD CONSTRAINT "pipeline_stacks_environment_id_deployment_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deployment_environments"("id") ON DELETE cascade ON UPDATE no action;