CREATE TABLE "organization_billing_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source_id" text NOT NULL,
	"licensed_seat_count" integer NOT NULL,
	"quantity_delta" integer NOT NULL,
	"active_seat_count" integer NOT NULL,
	"period_starts_at" timestamp NOT NULL,
	"period_ends_at" timestamp NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_lifecycle_events_source_idx" ON "organization_billing_lifecycle_events" USING btree ("organization_id","event_type","source_id");--> statement-breakpoint
CREATE INDEX "organization_billing_lifecycle_events_org_occurred_idx" ON "organization_billing_lifecycle_events" USING btree ("organization_id","occurred_at");