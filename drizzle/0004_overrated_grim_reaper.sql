CREATE TABLE "agent_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"version" integer NOT NULL,
	"instructions" text NOT NULL,
	"tool_names" text[] DEFAULT '{}' NOT NULL,
	"model_id" text NOT NULL,
	"max_steps" integer DEFAULT 6 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profile_versions_project_role_version_unique" UNIQUE("project_id","role","version")
);
--> statement-breakpoint
CREATE TABLE "ai_judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"stage" text,
	"round" integer,
	"profile_version_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"normalized" jsonb,
	"evidence" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"trace_id" text,
	"parent_judgment_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_judgments" ADD CONSTRAINT "ai_judgments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_judgments" ADD CONSTRAINT "ai_judgments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_judgments" ADD CONSTRAINT "ai_judgments_profile_version_id_agent_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."agent_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_judgments" ADD CONSTRAINT "ai_judgments_parent_judgment_id_ai_judgments_id_fk" FOREIGN KEY ("parent_judgment_id") REFERENCES "public"."ai_judgments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_judgments_ticket_idx" ON "ai_judgments" USING btree ("ticket_id","created_at");