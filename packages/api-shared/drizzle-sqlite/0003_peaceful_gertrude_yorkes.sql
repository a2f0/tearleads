CREATE TABLE `organization_billing_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_type` text NOT NULL,
	`source_id` text NOT NULL,
	`licensed_seat_count` integer NOT NULL,
	`quantity_delta` integer NOT NULL,
	`active_seat_count` integer NOT NULL,
	`period_starts_at` integer NOT NULL,
	`period_ends_at` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_lifecycle_events_source_idx` ON `organization_billing_lifecycle_events` (`organization_id`,`event_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_lifecycle_events_org_occurred_idx` ON `organization_billing_lifecycle_events` (`organization_id`,`occurred_at`);