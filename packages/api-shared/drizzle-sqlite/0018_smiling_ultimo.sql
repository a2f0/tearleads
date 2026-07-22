CREATE TABLE `organization_billing_stripe_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text,
	`subscription_id` text,
	`subscription_item_id` text,
	`price_id` text,
	`desired_paid_capacity` integer DEFAULT 0 NOT NULL,
	`desired_renewal_quantity` integer DEFAULT 0 NOT NULL,
	`applied_paid_capacity` integer DEFAULT 0 NOT NULL,
	`observed_quantity` integer,
	`desired_seat_period_key` text,
	`applied_seat_period_key` text,
	`billing_period_starts_at` integer,
	`billing_period_ends_at` integer,
	`desired_revision` integer DEFAULT 0 NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`in_flight_operation_id` text,
	`in_flight_target_capacity` integer,
	`next_attempt_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer,
	`last_error` text,
	`last_synced_at` integer,
	`last_invoice_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_seats_org_idx` ON `organization_billing_stripe_seats` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_seats_subscription_idx` ON `organization_billing_stripe_seats` (`subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_seats_item_idx` ON `organization_billing_stripe_seats` (`subscription_item_id`);--> statement-breakpoint
CREATE INDEX `organization_billing_stripe_seats_due_idx` ON `organization_billing_stripe_seats` (`next_attempt_at`,`lease_expires_at`,`organization_id`);--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `seat_period_key` text;