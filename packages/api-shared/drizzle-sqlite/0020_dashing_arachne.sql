CREATE TABLE `organization_billing_invoice_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_event_id` text,
	`invoice_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`billing_reason` text NOT NULL,
	`seat_count` integer,
	`price_id` text,
	`unit_amount` integer,
	`currency` text NOT NULL,
	`interval` text,
	`interval_count` integer,
	`total_amount` integer NOT NULL,
	`period_starts_at` integer,
	`period_ends_at` integer,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_invoice_events_invoice_idx` ON `organization_billing_invoice_events` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_invoice_events_org_occurred_idx` ON `organization_billing_invoice_events` (`organization_id`,`occurred_at`);