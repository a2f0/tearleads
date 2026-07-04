CREATE TABLE "organization_billing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'local' NOT NULL,
	"trial_ends_at" timestamp,
	"provider" text,
	"provider_customer_id" text,
	"entitlement_id" text,
	"current_period_ends_at" timestamp,
	"seat_count" integer,
	"disabled_at" timestamp,
	"purge_after" timestamp,
	"purge_started_at" timestamp,
	"purged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_org_idx" ON "organization_billing" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_billing_trial_expiry_idx" ON "organization_billing" USING btree ("status","trial_ends_at","organization_id");--> statement-breakpoint
CREATE INDEX "organization_billing_purge_candidates_idx" ON "organization_billing" USING btree ("status","purge_after","purge_started_at","organization_id");