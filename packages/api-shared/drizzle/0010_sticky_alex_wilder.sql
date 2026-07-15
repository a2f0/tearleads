CREATE TABLE "organization_billing_seat_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"billing_period_starts_at" timestamp,
	"billing_period_ends_at" timestamp,
	"assigned_at" timestamp NOT NULL,
	"released_at" timestamp,
	"assignment_source_type" text NOT NULL,
	"assignment_source_id" text NOT NULL,
	"release_source_type" text,
	"release_source_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_billing_seat_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"user_id" uuid,
	"quantity_delta" integer NOT NULL,
	"licensed_seat_count" integer NOT NULL,
	"active_seat_count" integer NOT NULL,
	"billing_period_starts_at" timestamp,
	"billing_period_ends_at" timestamp,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_principal_type" text,
	"source_principal_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_billing" ALTER COLUMN "seat_count" SET DEFAULT 0;--> statement-breakpoint
UPDATE "organization_billing" SET "seat_count" = 0 WHERE "seat_count" IS NULL;--> statement-breakpoint
ALTER TABLE "organization_billing" ALTER COLUMN "seat_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "provider_product_id" text;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "current_period_starts_at" timestamp;--> statement-breakpoint
ALTER TABLE "revenuecat_webhook_events" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "revenuecat_webhook_events" ADD COLUMN "transaction_id" text;--> statement-breakpoint
ALTER TABLE "revenuecat_webhook_events" ADD COLUMN "original_transaction_id" text;--> statement-breakpoint
ALTER TABLE "revenuecat_webhook_events" ADD COLUMN "purchased_at" timestamp;--> statement-breakpoint
ALTER TABLE "revenuecat_webhook_events" ADD COLUMN "expiration_at" timestamp;--> statement-breakpoint
CREATE INDEX "organization_billing_seat_assignments_org_open_idx" ON "organization_billing_seat_assignments" USING btree ("organization_id","released_at");--> statement-breakpoint
CREATE INDEX "organization_billing_seat_assignments_org_user_idx" ON "organization_billing_seat_assignments" USING btree ("organization_id","user_id","released_at");--> statement-breakpoint
CREATE INDEX "organization_billing_seat_assignments_org_period_idx" ON "organization_billing_seat_assignments" USING btree ("organization_id","billing_period_starts_at","billing_period_ends_at");--> statement-breakpoint
CREATE INDEX "organization_billing_seat_events_org_created_idx" ON "organization_billing_seat_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_billing_seat_events_org_source_idx" ON "organization_billing_seat_events" USING btree ("organization_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "organization_billing_seat_events_org_period_idx" ON "organization_billing_seat_events" USING btree ("organization_id","billing_period_starts_at","billing_period_ends_at");
