CREATE TABLE `organization_billing` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'local' NOT NULL,
	`trial_ends_at` integer,
	`provider` text,
	`provider_customer_id` text,
	`entitlement_id` text,
	`current_period_ends_at` integer,
	`seat_count` integer,
	`disabled_at` integer,
	`purge_after` integer,
	`purge_started_at` integer,
	`purged_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_org_idx` ON `organization_billing` (`organization_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_trial_expiry_idx` ON `organization_billing` (`status`,`trial_ends_at`,`organization_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_purge_candidates_idx` ON `organization_billing` (`status`,`purge_after`,`purge_started_at`,`organization_id`);