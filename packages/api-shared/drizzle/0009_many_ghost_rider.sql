CREATE TABLE "revenuecat_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"app_user_id" text NOT NULL,
	"organization_id" uuid,
	"outcome" text NOT NULL,
	"event_timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "revenuecat_webhook_events_event_id_idx" ON "revenuecat_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "revenuecat_webhook_events_org_idx" ON "revenuecat_webhook_events" USING btree ("organization_id");