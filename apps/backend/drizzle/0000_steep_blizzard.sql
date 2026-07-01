CREATE TABLE "app_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_from" text,
	"smtp_user" text,
	"smtp_pass" text,
	"smtp_tls" boolean DEFAULT true,
	"ai_provider" text,
	"ai_endpoint" text,
	"ai_api_key" text,
	"ai_model" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"action" text NOT NULL,
	"entity_id" bigint,
	"details" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branding" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"logo_data" "bytea",
	"logo_mime" text,
	"primary_color" text DEFAULT '#1e40af' NOT NULL,
	"secondary_color" text DEFAULT '#3b82f6' NOT NULL,
	"shop_name" text DEFAULT 'Open Hybrid Cloud' NOT NULL,
	"shop_subtitle" text DEFAULT '' NOT NULL,
	"imprint_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ci_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"access_token" text NOT NULL,
	"provider" text DEFAULT 'gitlab' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cost_centers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "deployment_environments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"ci_source_id" bigint NOT NULL,
	"webhook_url" text NOT NULL,
	"webhook_token" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency_code" text PRIMARY KEY NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infrastructure_elements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pipeline_id" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deployed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_center_id" bigint,
	"rejection_note" text,
	"pipeline_id" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parameters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" bigint DEFAULT 0 NOT NULL,
	"environment_id" bigint,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"default_value" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_environments" (
	"product_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"cost_center_mode" text DEFAULT 'project' NOT NULL,
	"forced_cost_center" boolean DEFAULT false NOT NULL,
	CONSTRAINT "product_environments_product_id_environment_id_pk" PRIMARY KEY("product_id","environment_id")
);
--> statement-breakpoint
CREATE TABLE "product_translations" (
	"product_id" bigint NOT NULL,
	"language_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "product_translations_product_id_language_code_pk" PRIMARY KEY("product_id","language_code")
);
--> statement-breakpoint
CREATE TABLE "product_webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text NOT NULL,
	"webhook_token" text NOT NULL,
	"exec_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_id" bigint NOT NULL,
	"base_language" text DEFAULT 'de' NOT NULL,
	"image" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" bigint NOT NULL,
	"cost_center_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sso_sub" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_sso_sub_unique" UNIQUE("sso_sub")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_environments" ADD CONSTRAINT "deployment_environments_ci_source_id_ci_sources_id_fk" FOREIGN KEY ("ci_source_id") REFERENCES "public"."ci_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_elements" ADD CONSTRAINT "infrastructure_elements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_elements" ADD CONSTRAINT "infrastructure_elements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_elements" ADD CONSTRAINT "infrastructure_elements_environment_id_deployment_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deployment_environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_elements" ADD CONSTRAINT "infrastructure_elements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_environment_id_deployment_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deployment_environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_environments" ADD CONSTRAINT "product_environments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_environments" ADD CONSTRAINT "product_environments_environment_id_deployment_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deployment_environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_webhooks" ADD CONSTRAINT "product_webhooks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_webhooks" ADD CONSTRAINT "product_webhooks_environment_id_deployment_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deployment_environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;