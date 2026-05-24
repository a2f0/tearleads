CREATE TABLE "organization_roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"profile_document_id" uuid,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp,
	"disabled_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_roster_entries_org_user_idx" ON "organization_roster_entries" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_roster_entries_org_status_idx" ON "organization_roster_entries" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organization_roster_entries_profile_document_idx" ON "organization_roster_entries" USING btree ("profile_document_id");