CREATE TABLE "parameter_projects" (
	"parameter_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	CONSTRAINT "parameter_projects_parameter_id_project_id_pk" PRIMARY KEY("parameter_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "parameter_projects" ADD CONSTRAINT "parameter_projects_parameter_id_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parameter_projects" ADD CONSTRAINT "parameter_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parameter_projects_project_idx" ON "parameter_projects" USING btree ("project_id");