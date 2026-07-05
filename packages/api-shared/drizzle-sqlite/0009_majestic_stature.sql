CREATE TABLE `revenuecat_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`app_user_id` text NOT NULL,
	`organization_id` text,
	`outcome` text NOT NULL,
	`event_timestamp_ms` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revenuecat_webhook_events_event_id_idx` ON `revenuecat_webhook_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `revenuecat_webhook_events_org_idx` ON `revenuecat_webhook_events` (`organization_id`);