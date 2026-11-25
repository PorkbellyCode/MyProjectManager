CREATE TABLE "required_fields" (
	"project_id" uuid NOT NULL,
	"category" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "required_fields_project_id_category_pk" PRIMARY KEY("project_id","category")
);
--> statement-breakpoint
CREATE TABLE "ticket_summaries" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"markdown" text NOT NULL,
	"data" jsonb NOT NULL,
	"generated_from" text NOT NULL,
	"edited_by" text,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "required_fields" ADD CONSTRAINT "required_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_summaries" ADD CONSTRAINT "ticket_summaries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_summaries" ADD CONSTRAINT "ticket_summaries_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;