CREATE TABLE `organization_billing_seat_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`billing_period_starts_at` integer,
	`billing_period_ends_at` integer,
	`assigned_at` integer NOT NULL,
	`released_at` integer,
	`assignment_source_type` text NOT NULL,
	`assignment_source_id` text NOT NULL,
	`release_source_type` text,
	`release_source_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_billing_seat_assignments_org_open_idx` ON `organization_billing_seat_assignments` (`organization_id`,`released_at`);--> statement-breakpoint
CREATE INDEX `organization_billing_seat_assignments_org_user_idx` ON `organization_billing_seat_assignments` (`organization_id`,`user_id`,`released_at`);--> statement-breakpoint
CREATE INDEX `organization_billing_seat_assignments_org_period_idx` ON `organization_billing_seat_assignments` (`organization_id`,`billing_period_starts_at`,`billing_period_ends_at`);--> statement-breakpoint
CREATE TABLE `organization_billing_seat_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_type` text NOT NULL,
	`user_id` text,
	`quantity_delta` integer NOT NULL,
	`licensed_seat_count` integer NOT NULL,
	`active_seat_count` integer NOT NULL,
	`billing_period_starts_at` integer,
	`billing_period_ends_at` integer,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_principal_type` text,
	`source_principal_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_billing_seat_events_org_created_idx` ON `organization_billing_seat_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `organization_billing_seat_events_org_source_idx` ON `organization_billing_seat_events` (`organization_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_seat_events_org_period_idx` ON `organization_billing_seat_events` (`organization_id`,`billing_period_starts_at`,`billing_period_ends_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organization_billing` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'local' NOT NULL,
	`trial_ends_at` integer,
	`provider` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`provider_product_id` text,
	`provider_transaction_id` text,
	`entitlement_id` text,
	`current_period_starts_at` integer,
	`current_period_ends_at` integer,
	`seat_count` integer DEFAULT 0 NOT NULL,
	`disabled_at` integer,
	`purge_after` integer,
	`purge_started_at` integer,
	`purged_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_organization_billing`("id", "organization_id", "status", "trial_ends_at", "provider", "provider_customer_id", "provider_subscription_id", "provider_product_id", "provider_transaction_id", "entitlement_id", "current_period_starts_at", "current_period_ends_at", "seat_count", "disabled_at", "purge_after", "purge_started_at", "purged_at", "created_at", "updated_at") SELECT "id", "organization_id", "status", "trial_ends_at", "provider", "provider_customer_id", NULL, NULL, NULL, "entitlement_id", NULL, "current_period_ends_at", COALESCE("seat_count", 0), "disabled_at", "purge_after", "purge_started_at", "purged_at", "created_at", "updated_at" FROM `organization_billing`;--> statement-breakpoint
DROP TABLE `organization_billing`;--> statement-breakpoint
ALTER TABLE `__new_organization_billing` RENAME TO `organization_billing`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_org_idx` ON `organization_billing` (`organization_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_trial_expiry_idx` ON `organization_billing` (`status`,`trial_ends_at`,`organization_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_purge_candidates_idx` ON `organization_billing` (`status`,`purge_after`,`purge_started_at`,`organization_id`);--> statement-breakpoint
ALTER TABLE `revenuecat_webhook_events` ADD `product_id` text;--> statement-breakpoint
ALTER TABLE `revenuecat_webhook_events` ADD `transaction_id` text;--> statement-breakpoint
ALTER TABLE `revenuecat_webhook_events` ADD `original_transaction_id` text;--> statement-breakpoint
ALTER TABLE `revenuecat_webhook_events` ADD `purchased_at` integer;--> statement-breakpoint
ALTER TABLE `revenuecat_webhook_events` ADD `expiration_at` integer;
