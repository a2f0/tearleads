CREATE TABLE "organization_billing_invoice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_event_id" text,
	"invoice_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"billing_reason" text NOT NULL,
	"seat_count" integer,
	"price_id" text,
	"unit_amount" bigint,
	"currency" text NOT NULL,
	"interval" text,
	"interval_count" integer,
	"total_amount" bigint NOT NULL,
	"period_starts_at" timestamp,
	"period_ends_at" timestamp,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_invoice_events_invoice_idx" ON "organization_billing_invoice_events" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "organization_billing_invoice_events_org_occurred_idx" ON "organization_billing_invoice_events" USING btree ("organization_id","occurred_at");